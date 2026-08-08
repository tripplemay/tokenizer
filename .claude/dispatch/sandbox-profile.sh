#!/usr/bin/env bash
# dispatch-mode.md 机件 #7「外部 CLI / 同会话桥接沙箱契约」——开车前置条件。
#
# 为什么需要它：autonomous-mode.md §6 的 deny-list 写在 .claude/settings.json 里，
# 只约束 Claude Code 自己的工具调用。一旦编排者拉起外部 CLI 子进程（codex/gemini/...），
# 那个进程有自己的权限模型、自己的工具集、自己的 shell —— deny-list 一条都拦不住，
# 闸门分类器更看不见（那是阶段内部的工具调用）。工具层拦不住，就在进程层拦。
#
# local-cli guardrails：env 白名单 · 独立 worktree · 禁 push · wall-clock 封顶。
# 历史 Seatbelt bridge 分支保留在本文件下方供未来 provider 迁移参考，但当前入口会在创建
# 任何 runtime 前拒绝它；它不是 external same-session 的发布基础。
#
# 用法：
#   sandbox-profile.sh --agent <agent-id> --envelope <envelope.json> [--ref <sha>]
#                      [--registry .agents-registry.json] [--adapters <dir>]
#                      [--expected-provenance <64-lowercase-hex>]
#                      [--timeout-helper <file>]
#                      [--workroot <dir>] [--state .harness-dispatch]
#
# 输出：stdout **只有** run-meta JSON（outcome / exit_code / artifact / worktree / duration_s），
#       供编排者机械解析；一切进度与告警走 stderr，不得污染 stdout；
#       同一份耐久落盘到 <state>/run-meta-<task_id>.json（默认项目内
#       .harness-dispatch）。日志仍只在 workroot，不上传。
# 退出码：0 = 子进程正常结束（outcome 仍可能是 ARTIFACT_MISSING，判定归编排者）
#         2 = 沙箱前置断言失败（fail-closed，未派活）
#         124 = 超时
#
# 本脚本不判 PASS/FAIL、不判 waiting、不写状态机文件——它只负责「安全地把活派出去并取回原始产物」。
# 语义判定归 validate-dispatch.sh + 编排者（铁律 12：结论原样落盘，运输层不参与评估）。

set -euo pipefail

REGISTRY=".agents-registry.json"
DISPATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_ADAPTERS="$DISPATCH_DIR/transports/adapters"
MODE_ADAPTERS="$DISPATCH_DIR/resolve-mode-adapters.sh"
ADAPTERS=""
TIMEOUT_HELPER="$DISPATCH_DIR/process-timeout.py"
WORKROOT="../.harness-dispatch"
STATE=".harness-dispatch"
AGENT_ID=""
INTEGRATION_ID=""
ENVELOPE=""
REF=""
PROFILE=""
EXPECTED_PROVENANCE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --agent)    [ "$#" -ge 2 ] || { echo "[sandbox] ⛔ --agent 缺值" >&2; exit 2; }; AGENT_ID="$2"; shift 2 ;;
    --integration) [ "$#" -ge 2 ] || { echo "[sandbox] ⛔ --integration 缺值" >&2; exit 2; }; INTEGRATION_ID="$2"; shift 2 ;;
    --envelope) [ "$#" -ge 2 ] || { echo "[sandbox] ⛔ --envelope 缺值" >&2; exit 2; }; ENVELOPE="$2"; shift 2 ;;
    --ref)      [ "$#" -ge 2 ] || { echo "[sandbox] ⛔ --ref 缺值" >&2; exit 2; }; REF="$2"; shift 2 ;;
    --registry) [ "$#" -ge 2 ] || { echo "[sandbox] ⛔ --registry 缺值" >&2; exit 2; }; REGISTRY="$2"; shift 2 ;;
    --adapters) [ "$#" -ge 2 ] || { echo "[sandbox] ⛔ --adapters 缺值" >&2; exit 2; }; ADAPTERS="$2"; shift 2 ;;
    --expected-provenance) [ "$#" -ge 2 ] || { echo "[sandbox] ⛔ --expected-provenance 缺值" >&2; exit 2; }; EXPECTED_PROVENANCE="$2"; shift 2 ;;
    --timeout-helper) [ "$#" -ge 2 ] || { echo "[sandbox] ⛔ --timeout-helper 缺值" >&2; exit 2; }; TIMEOUT_HELPER="$2"; shift 2 ;;
    --workroot) [ "$#" -ge 2 ] || { echo "[sandbox] ⛔ --workroot 缺值" >&2; exit 2; }; WORKROOT="$2"; shift 2 ;;
    --state)    [ "$#" -ge 2 ] || { echo "[sandbox] ⛔ --state 缺值" >&2; exit 2; }; STATE="$2"; shift 2 ;;
    *) echo "[sandbox] ⛔ 未知参数：$1" >&2; exit 2 ;;
  esac
done

die() { echo "[sandbox] ⛔ $1" >&2; exit 2; }

# ── 0. 前置断言（fail-closed：任一不满足即不派活）─────────────────────────
if [ -n "$AGENT_ID" ] && [ -n "$INTEGRATION_ID" ]; then
  die "--agent 与 --integration 不得同时提供"
fi
[ -n "$AGENT_ID" ] || [ -n "$INTEGRATION_ID" ] || die "缺 --agent 或 --integration"
if [ -n "$AGENT_ID" ]; then
  [[ "$AGENT_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || \
    die "--agent 必须是 1..128 位安全稳定标识"
fi
if [ -n "$INTEGRATION_ID" ]; then
  [[ "$INTEGRATION_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || \
    die "--integration 必须是 1..128 位安全稳定标识"
fi
[ -n "$ENVELOPE" ]   || die "缺 --envelope"
[ -f "$ENVELOPE" ]   || die "信封文件不存在：$ENVELOPE"
[ -n "$REGISTRY" ]   || die "缺 --registry"
command -v python3 >/dev/null 2>&1 || die "python3 不可用"
command -v git     >/dev/null 2>&1 || die "git 不可用"
[ -f "$TIMEOUT_HELPER" ] || die "timeout helper 不存在：$TIMEOUT_HELPER"
if [ -n "$EXPECTED_PROVENANCE" ] && ! [[ "$EXPECTED_PROVENANCE" =~ ^[0-9a-f]{64}$ ]]; then
  die "--expected-provenance 必须是 64 位小写十六进制 SHA-256"
fi

# repo.url 的本地目标身份必须在创建 workroot/state/clone/worktree 之前确定。
ENVELOPE_ABS="$(cd "$(dirname "$ENVELOPE")" && pwd)/$(basename "$ENVELOPE")"
# dispatch-run.sh normally executes this check first, but sandbox-profile.sh is
# also a supported direct entrypoint. Keep the same path contract here before
# batch/task/artifact values can influence worktree, state, log, or artifact
# locations.
bash "$DISPATCH_DIR/validate-dispatch.sh" envelope "$ENVELOPE_ABS" >&2 \
  || die "信封校验未过，不创建沙箱"
MAIN_REPO="$(python3 "$DISPATCH_DIR/dispatch_common.py" repo-preflight \
  --envelope "$ENVELOPE_ABS" --cwd "$PWD")" || die "repo.url 前置校验未过，不创建沙箱"
REGISTRY="$(python3 "$DISPATCH_DIR/dispatch_common.py" project-registry \
  --project-root "$MAIN_REPO" --registry "$REGISTRY")" \
  || die "注册表必须是项目根的非符号链接 .agents-registry.json"

# Direct sandbox use must obey the same active checkpoint as dispatch-run.sh.
# Without this recovery a custom adapter selected during /plan would validate
# successfully there and then silently fall back to the framework default here.
CANONICAL_PROGRESS="$MAIN_REPO/progress.json"
if [ -f "$CANONICAL_PROGRESS" ]; then
  [ -x "$MODE_ADAPTERS" ] || die "resolve-mode-adapters.sh 不存在或不可执行"
  MODE_ADAPTER_ARGS=(--progress "$CANONICAL_PROGRESS" --default "$DEFAULT_ADAPTERS")
  [ -z "$ADAPTERS" ] || MODE_ADAPTER_ARGS+=(--adapters "$ADAPTERS")
  ADAPTERS="$(bash "$MODE_ADAPTERS" "${MODE_ADAPTER_ARGS[@]}")" \
    || die "无法恢复 active mode 的 adapter 目录"
else
  ADAPTERS="${ADAPTERS:-$DEFAULT_ADAPTERS}"
  [ -d "$ADAPTERS" ] || die "适配器目录不存在：$ADAPTERS"
  ADAPTERS="$(python3 - "$ADAPTERS" <<'PY'
import os
import sys
print(os.path.realpath(sys.argv[1]))
PY
)"
fi

# sandbox-profile.sh is a supported direct entrypoint. An active v2 checkpoint
# owns both the selected target and its execution provenance, so a caller must
# not bypass dispatch-run.sh by calling this lower-level profile with a
# different --agent *or* a differently-derived --integration target.
# Legacy/v1/fast progress returns {} and intentionally keeps the historical
# direct behavior.
if { [ -n "$AGENT_ID" ] || [ -n "$INTEGRATION_ID" ]; } && [ -f "$CANONICAL_PROGRESS" ]; then
  ENVELOPE_ROLE="$(python3 - "$ENVELOPE_ABS" <<'PY'
import json
import sys

try:
    role = json.load(open(sys.argv[1], encoding="utf-8")).get("role")
except (OSError, ValueError) as exc:
    raise SystemExit(f"[sandbox] ⛔ 无法读取已校验信封 role：{exc}")
if role not in ("planner", "generator", "evaluator"):
    raise SystemExit(f"[sandbox] ⛔ 已校验信封 role 非法：{role!r}")
print(role)
PY
)" || die "无法读取已校验信封 role"
  ACTIVE_TARGET_ID="$AGENT_ID"
  if [ -n "$INTEGRATION_ID" ]; then
    [[ "$INTEGRATION_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || \
      die "--integration 必须是 1..128 位安全稳定标识"
    ACTIVE_TARGET_ID="local-cli--${INTEGRATION_ID}--${ENVELOPE_ROLE}"
  fi
  ACTIVE_ARGS=(--role "$ENVELOPE_ROLE" --expected-agent "$ACTIVE_TARGET_ID" --progress "$CANONICAL_PROGRESS" --registry "$REGISTRY")
  ACTIVE_ARGS+=(--adapters "$ADAPTERS")
  ACTIVE_ROLE="$(bash "$DISPATCH_DIR/resolve-active-mode-role.sh" "${ACTIVE_ARGS[@]}")" \
    || die "active mode role 复验失败；拒绝绕过 dispatch-run 的 target 选择"
  ACTIVE_EXPECTED_PROVENANCE="$(python3 - "$ACTIVE_ROLE" <<'PY'
import json
import re
import sys

try:
    value = json.loads(sys.argv[1])
except (TypeError, ValueError) as exc:
    raise SystemExit(f"[sandbox] ⛔ active mode role JSON 非法：{exc}")
if value == {}:
    print("")
    raise SystemExit(0)
if not isinstance(value, dict):
    raise SystemExit("[sandbox] ⛔ active mode role 必须是 object 或 {}")
provenance = value.get("execution_provenance_sha256")
if not isinstance(provenance, str) or not re.fullmatch(r"[0-9a-f]{64}", provenance):
    raise SystemExit("[sandbox] ⛔ active v2 role 缺有效 execution_provenance_sha256；需重新规划")
print(provenance)
PY
)" || die "无法恢复 active mode execution provenance"
  if [ -n "$ACTIVE_EXPECTED_PROVENANCE" ]; then
    if [ -n "$EXPECTED_PROVENANCE" ] && [ "$EXPECTED_PROVENANCE" != "$ACTIVE_EXPECTED_PROVENANCE" ]; then
      die "--expected-provenance 与 active v2 checkpoint 不一致"
    fi
    EXPECTED_PROVENANCE="$ACTIVE_EXPECTED_PROVENANCE"
  fi
fi

# ── 1. 解析 descriptor + adapter（受限 JSON 配置，绝不 eval）───────────────
# Registry and adapter strings are untrusted at this direct entrypoint. Keep
# them as JSON values, then read scalars/arrays without ever re-parsing them as
# shell source. This is intentionally more verbose than a shell-code bridge: one bad
# descriptor must be unable to execute in the Coordinator shell.
PROFILE="$(mktemp)"
cleanup_profile() { [ -z "$PROFILE" ] || rm -f "$PROFILE"; }
trap cleanup_profile EXIT
if ! python3 - "$REGISTRY" "$AGENT_ID" "$INTEGRATION_ID" "$ADAPTERS" "$ENVELOPE_ABS" "$DISPATCH_DIR" "$PROFILE" "$EXPECTED_PROVENANCE" <<'PY'
import hmac
import importlib.util
import json
import os
import re
import sys
import subprocess
reg_path, agent_id, integration_id, adapters_dir, env_path, dispatch_dir, output_path, expected_provenance = sys.argv[1:9]
sys.path.insert(0, dispatch_dir)
from dispatch_common import (
    DispatchContractError,
    effective_timeout,
    external_environment_allowlist,
    external_environment_set,
)

def fail(msg):
    print(f"[sandbox] ⛔ {msg}", file=sys.stderr)
    raise SystemExit(2)

try:
    env = json.load(open(env_path))
except Exception as e:
    fail(f"信封 JSON 非法：{e}")
role = env.get("role") or fail("信封缺 role")

if integration_id:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", integration_id):
        fail(f"--integration 非法：{integration_id!r}")
    target_id = f"local-cli--{integration_id}--{role}"
else:
    target_id = agent_id
catalog = os.path.join(dispatch_dir, "tool-catalog.py")
try:
    resolved = subprocess.run(
        [sys.executable, catalog, "target", "--registry", reg_path,
         "--adapters", adapters_dir, "--target-id", target_id],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
except OSError as exc:
    fail(f"无法启动 tool-catalog.py：{exc}")
if resolved.returncode != 0:
    fail(f"内部执行目标不可用：{(resolved.stderr or resolved.stdout).strip()[:600]}")
try:
    target = json.loads(resolved.stdout)
except (TypeError, ValueError) as exc:
    fail(f"内部执行目标 JSON 非法：{exc}")
if not isinstance(target, dict):
    fail("内部执行目标必须是 object")
target_provenance = target.get("execution_provenance_sha256")
if not isinstance(target_provenance, str) or not re.fullmatch(r"[0-9a-f]{64}", target_provenance):
    fail("内部执行目标缺有效 execution_provenance_sha256")
if expected_provenance and not hmac.compare_digest(target_provenance, expected_provenance):
    fail("fresh target execution_provenance_sha256 与期望值不一致；拒绝 provenance drift")
transport = target.get("invocation")
if transport not in ("local-cli", "subagent"):
    fail(f"{target_id} 的 invocation={transport!r}，本脚本只处理 local-cli 或已验证同会话 bridge")
if role not in (target.get("roles") or []):
    fail(f"{target_id} 的 roles={target.get('roles')!r} 不含信封 role={role!r}")
d = {
    "id": target_id,
    "tool": target.get("tool"),
    "transport": transport,
    "adapter": target.get("adapter"),
    "model_family": target.get("model_family"),
    "sandbox": target.get("sandbox"),
    "timeout_s": target.get("timeout_s"),
    "roles": target.get("roles"),
    "agent_type": target.get("agent_type"),
    "bridge_id": target.get("bridge_id"),
    "bridge_strategy": target.get("bridge_strategy"),
    "bridge_protocol": target.get("bridge_protocol"),
    "constraints": {"l2": False, "write_src": role == "generator", "push": False},
}

adapter_name = d.get("adapter") or ""
if not adapter_name:
    fail(f"{agent_id} 未声明 adapter")
if not isinstance(adapter_name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", adapter_name):
    fail(f"{agent_id} 的 adapter 必须是安全稳定标识")
ad_path = os.path.join(adapters_dir, adapter_name + ".json")
try:
    ad = json.load(open(ad_path))
except Exception as e:
    fail(f"适配器不可读（{ad_path}）：{e}")
if not isinstance(ad, dict):
    fail(f"适配器必须是 object：{ad_path}")
if ad.get("name") != adapter_name:
    fail(f"适配器文件名 {adapter_name!r} 与 adapter.name={ad.get('name')!r} 不一致")
if ad.get("_verified") is not True:
    fail(f"适配器 {adapter_name!r} 未标记 _verified=true，不能执行")
adapter_family = ad.get("model_family")
if adapter_family != d.get("model_family"):
    fail(f"适配器 {adapter_name!r} model_family 与 descriptor 不一致")
delivery = ad.get("envelope_delivery")
if delivery not in ("stdin", "argv", "env"):
    fail(f"适配器 {adapter_name!r}.envelope_delivery 必须为 stdin、argv 或 env")
argv = ad.get("argv")
if not isinstance(argv, list) or not argv or any(not isinstance(item, str) or not item for item in argv):
    fail(f"适配器 {adapter_name!r}.argv 必须是非空 string array")
adapter_tool = ad.get("tool", adapter_name)
descriptor_tool = d.get("tool")
if not isinstance(adapter_tool, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", adapter_tool):
    fail(f"适配器 {adapter_name!r}.tool 必须是安全稳定标识")
if descriptor_tool is not None and (
    not isinstance(descriptor_tool, str)
    or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", descriptor_tool)
    or descriptor_tool != adapter_tool
):
    fail(f"{agent_id} 的 tool 与适配器 {adapter_name!r} 的 tool 不一致")
try:
    adapter_env_allow = external_environment_allowlist(
        ad.get("env_allowlist_extra"), f"adapter {adapter_name!r}.env_allowlist_extra"
    )
except DispatchContractError as e:
    fail(str(e))

# ── codex：自定义 provider × --ignore-user-config 前置（fail-closed）───────
# 该 flag 的语义是 CLI help 原文写死的：
#     Do not load `$CODEX_HOME/config.toml`; auth still uses `CODEX_HOME`
# 忽略 config、却照读 auth.json。用户若把认证挂在**自定义 provider**（中转 / 自建网关 /
# Azure）上，忽略 config 就等于拿着 A 家的 key 去敲 B 家的门 —— 确定性 401，重派无效。
# 不拦的代价是实测过的（newkolmatrix M5.1-TENANT-INJECTION）：两派两停（159s + 47s）、
# 烧光 dispatch-mode.md §3.4 的重派额度、批次锁死在 verifying 且流转图上无边可走，
# 最后靠人类闸门破例重划批次才解开。这里花 0.1s 换成一条带修法的前置错误。
# 只在「明确两个信号都命中」时拦，读不到 / 解析不出一律放行 —— 前置检查本身不得成为
# 新的失败源。不用 tomllib：它要 python 3.11+，而本机件的最低面是系统自带 python3。
def _codex_ignore_user_config_preflight():
    if adapter_tool != "codex" or "--ignore-user-config" not in argv:
        return
    if any(tok.startswith("model_providers.") for tok in argv):
        return                                    # 已用 -c 显式注入 provider，认证补回来了
    env_set = (d.get("sandbox") or {}).get("env_set") or {}
    codex_home = env_set.get("CODEX_HOME") or os.environ.get("CODEX_HOME") or "~/.codex"
    cfg_path = os.path.join(os.path.expanduser(codex_home), "config.toml")
    try:
        with open(cfg_path, encoding="utf-8") as fh:
            cfg_text = fh.read()
    except OSError:
        return                                    # 无个人 config → 无自定义 provider
    picked = re.search(r"^[ \t]*model_provider[ \t]*=[ \t]*[\"']([^\"'\n]+)[\"']",
                       cfg_text, re.M)
    if not picked:
        return                                    # 用内置 provider，忽略 config 不动认证
    provider = picked.group(1)
    quoted = re.escape(provider)
    header = re.search(
        rf"^[ \t]*\[model_providers\.(?:{quoted}|\"{quoted}\")\][ \t]*$", cfg_text, re.M
    )
    if not header:
        return                                    # 该 provider 不是 config 自定义的
    section = cfg_text[header.end():]
    nxt = re.search(r"^[ \t]*\[", section, re.M)
    base = re.search(r"^[ \t]*base_url[ \t]*=[ \t]*[\"']([^\"'\n]+)[\"']",
                     section[: nxt.start()] if nxt else section, re.M)
    base_url = base.group(1) if base else "<你的 base_url>"
    fail(
        f"codex 适配器带 --ignore-user-config，而 {cfg_path} 把 model_provider 指向"
        f"自定义 provider [{provider}]。\n"
        "  该 flag 丢弃这段 provider 定义、却仍读同目录的 auth.json —— 端点与凭据必然错配，"
        "派出去是确定性 401 invalid_api_key，重派多少次都一样。已在派活前拦下。\n"
        "  修法 A（推荐，保住配置隔离）：在本项目 adapters/codex.json 的 argv 里补 -c 注入 ——\n"
        f'      "-c", "model_provider={provider}",\n'
        f'      "-c", "model_providers.{provider}={{name=\\"{provider}\\",'
        f'base_url=\\"{base_url}\\",wire_api=\\"responses\\",requires_openai_auth=true}}",\n'
        '      "-c", "model=<你的模型>",   ← 必须钉：不钉则静默回落 CLI 默认模型\n'
        "  修法 B：删掉 argv 里的 --ignore-user-config —— 但它原本挡的是个人 config 的\n"
        "      danger-full-access / approval_policy=never / 自定义指令 profile / MCP servers\n"
        "      被派发任务继承，删之前先确认你的个人 config 交给外部 agent 也安全。\n"
        "  详见 transports/local-cli.md §8「自定义 provider 用户的接入」。"
    )


_codex_ignore_user_config_preflight()

# 非阻断提醒：config 被忽略后 model 会静默回落到 CLI 默认值 —— 等于在无人知情的情况下
# 换掉了这个角色实际使用的模型。不硬拦（默认模型也能跑），但必须让它出现在 stderr。
if (
    adapter_tool == "codex"
    and "--ignore-user-config" in argv
    and not any(tok.startswith("model=") for tok in argv)
):
    print(
        f"[sandbox] ⚠️ 适配器 {adapter_name!r} 带 --ignore-user-config 但未用 -c model= 钉住模型，"
        "实际跑的是 codex CLI 的默认模型，而非你个人 config 里选的那个。",
        file=sys.stderr,
    )

# The catalog read this adapter while resolving target. Re-read the exact
# execution contract and compare its domain-separated digest before emitting a
# profile, so a file swap between catalog resolution and launch cannot alter
# argv, delivery, environment policy, or a future execution-relevant knob.
target_adapter_contract = target.get("adapter_execution_contract_sha256")
if not isinstance(target_adapter_contract, str) or not re.fullmatch(r"[0-9a-f]{64}", target_adapter_contract):
    fail(f"{target_id} 缺有效 adapter_execution_contract_sha256")
catalog_spec = importlib.util.spec_from_file_location(
    "harness_tool_catalog_contract", os.path.join(dispatch_dir, "tool-catalog.py")
)
if catalog_spec is None or catalog_spec.loader is None:
    fail("无法加载 tool-catalog adapter contract 算法")
catalog_module = importlib.util.module_from_spec(catalog_spec)
sys.modules[catalog_spec.name] = catalog_module
try:
    catalog_spec.loader.exec_module(catalog_module)
    observed_adapter_contract = catalog_module.adapter_execution_contract_sha256(
        ad,
        declared_name=adapter_name,
        adapter_tool=adapter_tool,
        adapter_family=adapter_family,
        argv=argv,
        envelope_delivery=delivery,
        env_allowlist_extra=adapter_env_allow,
    )
except Exception as exc:
    fail(f"无法复算适配器 execution contract：{exc}")
if not hmac.compare_digest(target_adapter_contract, observed_adapter_contract):
    fail("适配器 execution contract 与 fresh target 不一致；拒绝 catalog-to-adapter drift")

bridge_id = ""
bridge_strategy = ""
bridge_protocol = None
agent_type = d.get("agent_type")
if transport == "subagent":
    bridge_id = d.get("bridge_id")
    bridge_strategy = d.get("bridge_strategy")
    bridge_protocol = d.get("bridge_protocol")
    if not isinstance(bridge_id, str) or bridge_id == "host-native" or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", bridge_id):
        fail(f"{target_id} 不是可执行的同会话 bridge target")
    if not isinstance(bridge_strategy, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", bridge_strategy):
        fail(f"{target_id} 的 bridge strategy 非法")
    if not isinstance(agent_type, str) or not agent_type:
        fail(f"{target_id} 的 bridge subagent persona 缺失")
    if not isinstance(bridge_protocol, dict) or set(bridge_protocol) != {"kind", "command", "request_delivery", "response_format"}:
        fail(f"{target_id} 的 bridge protocol 非法")
    if not isinstance(bridge_protocol.get("kind"), str) or not bridge_protocol["kind"]:
        fail(f"{target_id} 的 bridge protocol.kind 非法")
    if not isinstance(bridge_protocol.get("command"), list) or not bridge_protocol["command"] or any(not isinstance(item, str) or not item for item in bridge_protocol["command"]):
        fail(f"{target_id} 的 bridge protocol.command 非法")
    if bridge_protocol.get("request_delivery") not in ("stdin", "argv", "env") or bridge_protocol.get("response_format") != "json":
        fail(f"{target_id} 的 bridge protocol delivery/response 非法")
    # The Harness process owns the bridge invocation. It receives the envelope
    # by argv and then speaks the vendor protocol internally; never route the
    # untrusted envelope through a command template from the registry.
    delivery = "argv"
    argv = []

batch    = env.get("batch") or fail("信封缺 batch")
task_id  = env.get("task_id") or fail("信封缺 task_id（幂等键）")
ref      = (env.get("repo") or {}).get("ref") or ""

constraints = d.get("constraints") or {}
if not isinstance(constraints, dict):
    fail(f"{agent_id} 的 constraints 必须为 object")
if role == "generator":
    if constraints.get("write_src") is not True:
        fail(f"local-cli Generator {agent_id!r} 必须 constraints.write_src=true")
    if constraints.get("push") is not False:
        fail(f"local-cli Generator {agent_id!r} 必须 constraints.push=false")
    if constraints.get("l2") is not False:
        fail(f"local-cli Generator {agent_id!r} 必须 constraints.l2=false")

sb       = d.get("sandbox") or {}
if not isinstance(sb, dict):
    fail(f"{agent_id} 的 sandbox 必须为 object")
try:
    sandbox_env_allow = external_environment_allowlist(
        sb.get("env_allow"), f"{agent_id}.sandbox.env_allow"
    )
    sandbox_env_set = external_environment_set(
        sb.get("env_set"), f"{agent_id}.sandbox.env_set"
    )
except DispatchContractError as e:
    fail(str(e))
# 产物路径的优先级：**信封 > 适配器 > 默认约定**。
# 信封是「这一次任务」的契约，适配器只是「这家 CLI」的默认约定 —— 契约必须压过约定。
# 原实现只读适配器（默认 `<batch>-verdict.json`），于是 generator 派活（交 handoff 工件）
# 的产物永远被判 ARTIFACT_MISSING：它按信封写在 handoff.json，沙箱却去找 verdict.json。
# 实测踩到（BL-MODESCMD，Codex 写完代码交了 handoff，回执仍报「产物缺失」）。
_dl = (env.get("deliverable") or {}).get("artifact")
if not isinstance(_dl, str) or not _dl:
    fail("信封 deliverable.artifact 缺失")
artifact = _dl

try:
    timeout_cap = effective_timeout(None, d.get("timeout_s"))
    timeout = effective_timeout(env.get("deadline_s"), timeout_cap)
except DispatchContractError as e:
    fail(str(e))
# home_dir 必须展开 ~ 并绝对化。相对/未展开的 HOME 有两层危害（实测踩到）：
# ① 子进程把 HOME 当相对路径 → 在 CWD 下造出字面量 `~/` 垃圾目录；
# ② 下面的 dotfile fail-closed 断言会去检查一个**不存在的相对路径**，
#    于是静默通过、等于没检查 —— L1 的护栏被悄悄削掉。
_home = sb.get("home_dir", "")
if _home:
    # 判据必须在展开**之前**：abspath 会把相对路径也变成绝对路径，放在之后等于没判。
    # 拒相对路径的理由：它会静默地相对「编排者恰好所处的 CWD」解析，结果不确定。
    if not (_home.startswith("/") or _home.startswith("~")):
        fail(f"sandbox.home_dir 必须以 / 或 ~ 开头（当前 {_home!r}）—— 相对路径会随 CWD 漂移")
    _home = os.path.abspath(os.path.expanduser(_home))
allow = ["PATH", "HOME", "LANG", "LC_ALL", "TERM", "TMPDIR", "USER", "SHELL"]
allow += adapter_env_allow + sandbox_env_allow
seen, uniq = set(), []
for k in allow:
    if k not in seen:
        seen.add(k); uniq.append(k)
# env_set：字面注入的键值（~ 展开）。只注入该 CLI 的认证目录，
# 而不是把整个真实 HOME 放进白名单连带暴露 ~/.aws 等。
config = {
    "target_id": target_id,
    "adapter": adapter_name,
    "transport": transport,
    "family": d.get("model_family", ""),
    "timeout_cap": timeout_cap,
    "timeout": timeout,
    "deadline": env.get("deadline_s", ""),
    "home": _home,
    "delivery": delivery,
    "write_src": constraints.get("write_src") is True,
    "batch": batch,
    "task_id": task_id,
    "ref": ref,
    "role": env.get("role") or "",
    "deliverable_json": json.dumps(env.get("deliverable") or {}, ensure_ascii=False, separators=(",", ":")),
    "artifact": artifact,
    "argv": argv,
    "env_allow": uniq,
    "env_set": [f"{key}={os.path.expanduser(value)}" for key, value in sandbox_env_set.items()],
    "agent_type": agent_type or "",
    "bridge_id": bridge_id,
    "bridge_strategy": bridge_strategy,
    "bridge_protocol_json": json.dumps(bridge_protocol, ensure_ascii=False, separators=(",", ":")) if bridge_protocol is not None else "",
}
json.dump(config, open(output_path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
PY
then
  exit 2
fi

profile_scalar() {
  python3 - "$PROFILE" "$1" <<'PY'
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
value = data.get(sys.argv[2])
if isinstance(value, bool):
    print("true" if value else "false")
elif value is None:
    print("")
else:
    print(str(value))
PY
}

profile_array() {
  python3 - "$PROFILE" "$1" <<'PY'
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
value = data.get(sys.argv[2])
if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
    raise SystemExit("[sandbox] ⛔ 内部 profile array 非法")
for item in value:
    sys.stdout.buffer.write(item.encode("utf-8") + b"\0")
PY
}

E_TARGET_ID="$(profile_scalar target_id)"
[ -n "$E_TARGET_ID" ] || die "内部 profile 缺 target_id"
D_ADAPTER="$(profile_scalar adapter)"
D_TRANSPORT="$(profile_scalar transport)"
D_FAMILY="$(profile_scalar family)"
D_TIMEOUT_CAP="$(profile_scalar timeout_cap)"
D_TIMEOUT="$(profile_scalar timeout)"
E_DEADLINE="$(profile_scalar deadline)"
D_HOME="$(profile_scalar home)"
D_ENVELOPE_DELIVERY="$(profile_scalar delivery)"
D_WRITE_SRC="$(profile_scalar write_src)"
E_BATCH="$(profile_scalar batch)"
E_TASK_ID="$(profile_scalar task_id)"
E_REF="$(profile_scalar ref)"
E_ROLE="$(profile_scalar role)"
E_DELIVERABLE="$(profile_scalar deliverable_json)"
E_ARTIFACT="$(profile_scalar artifact)"
D_AGENT_TYPE="$(profile_scalar agent_type)"
D_BRIDGE_ID="$(profile_scalar bridge_id)"
D_BRIDGE_STRATEGY="$(profile_scalar bridge_strategy)"
D_BRIDGE_PROTOCOL_JSON="$(profile_scalar bridge_protocol_json)"
D_ARGV_TEMPLATE=()
while IFS= read -r -d '' item; do D_ARGV_TEMPLATE+=("$item"); done < <(profile_array argv)
D_ENV_ALLOW=()
while IFS= read -r -d '' item; do D_ENV_ALLOW+=("$item"); done < <(profile_array env_allow)
D_ENV_SET=()
while IFS= read -r -d '' item; do D_ENV_SET+=("$item"); done < <(profile_array env_set)

[ -n "$REF" ] || REF="$E_REF"
[ -n "$REF" ] || REF="$(git -C "$MAIN_REPO" rev-parse HEAD)"
[ "$D_TRANSPORT" = "local-cli" ] || [ "$D_TRANSPORT" = "subagent" ] || \
  die "内部 profile transport 非法：$D_TRANSPORT"

# A project manifest and a Seatbelt profile cannot create a strict external
# same-session trust boundary. The published vm-v1 provider has its own
# copy-in, brokered credential/network, and job-lifecycle path; this direct
# sandbox entry is not that path. Reject even a stale target before any
# worktree, runtime state, or vendor process can be created.
if [ "$D_TRANSPORT" = "subagent" ]; then
  die "external same-session bridge must be launched by the framework vm-v1 provider, not sandbox-profile.sh"
fi

# ── 2. 独立 worktree（锁定到 sha，detach，不设 upstream）────────────────────
mkdir -p "$WORKROOT"
mkdir -p "$STATE"
WORKROOT_ABS="$(cd "$WORKROOT" && pwd)"
STATE_ROOT="$(cd "$STATE" && pwd)"
BRIDGE_RUNTIME_ROOT=""
cleanup_bridge_runtime() {
  if [ -n "${BRIDGE_RUNTIME_ROOT:-}" ]; then
    case "$BRIDGE_RUNTIME_ROOT" in
      "$WORKROOT_ABS"/.bridge-runtime-"$E_TASK_ID".*) rm -rf -- "$BRIDGE_RUNTIME_ROOT" ;;
      *) echo "[sandbox] ⛔ 拒绝清理非本次 bridge runtime 目录" >&2 ;;
    esac
  fi
}
trap 'cleanup_bridge_runtime; cleanup_profile' EXIT
WT="$WORKROOT_ABS/${E_BATCH}-${E_TARGET_ID}-${E_TASK_ID}"
[ -e "$WT" ] && die "worktree 已存在：${WT}（同 task_id 重复派活？幂等键应去重）"
# 🔴 写代码的角色不能用 worktree。git worktree 把元数据放在**主仓**的
# `.git/worktrees/<name>/`，而外部 CLI 的厂商沙箱（Codex 的 -s workspace-write）只允许
# 写 workspace 目录本身 —— 于是 `git commit` 连 index.lock 都建不出来（实测原话：
# "Operation not permitted"）。四道锁的 L2 与厂商沙箱在这里相互不兼容：外部 generator
# 拿不到任何提交能力，只能交出未提交的改动。
# 改用 `git clone --shared`：.git 落在沙箱目录内（可写），object 仍与主仓共享（不复制体积）。
# 隔离性不降反升 —— 不再与主仓共用 .git，主仓连元数据都不会被碰。
if [ "${D_WRITE_SRC:-false}" = true ]; then
  git clone --shared --no-checkout "$MAIN_REPO" "$WT" >/dev/null 2>&1 \
    || die "沙箱克隆创建失败（ref=${REF}）"
  git -C "$WT" checkout --detach "$REF" >/dev/null 2>&1 \
    || die "沙箱克隆 checkout 失败（ref=${REF}）"
  # origin 指向本机主仓，push 仍被 GIT_CONFIG 层的 pushurl 覆盖挡住（见下）；
  # 另把 fetch url 也断掉，避免子进程从主仓拉到不该看的分支。
  git -C "$WT" remote set-url origin DISABLED_BY_HARNESS_SANDBOX >/dev/null 2>&1 || true
  echo "[sandbox] 独立克隆（write_src=true）: $WT @ ${REF:0:12}" >&2
else
  git worktree add --detach "$WT" "$REF" >/dev/null 2>&1 \
    || die "worktree 创建失败（ref=${REF}）"
  echo "[sandbox] worktree: $WT @ ${REF:0:12}" >&2
fi

ENVELOPE_JSON="$(cat "$ENVELOPE_ABS")"

# ── 3. env 白名单（构造子进程环境；未列出的一律不传）────────────────────────
# 关键：这是「没凭据就花不了钱」那一招。prod DATABASE_URL / 各家 API key /
# AWS_* / VERCEL_TOKEN 等一律不进白名单 → 子进程拿不到 → 结构上无法触达生产与计费。
ENV_ARGS=()
for k in "${D_ENV_ALLOW[@]}"; do
  if [ -n "${!k+x}" ]; then ENV_ARGS+=("$k=${!k}"); fi
done
# 字面注入（descriptor.sandbox.env_set）——优先于白名单继承，用于精确投喂该 CLI 的认证位置
for kv in ${D_ENV_SET[@]+"${D_ENV_SET[@]}"}; do ENV_ARGS+=("$kv"); done
# 禁 push：env 级 git config 覆盖，只影响子进程，不写磁盘 config
# （worktree 与主仓共享 .git/config，用 `git remote set-url` 会污染主仓——绝不可用）
ENV_ARGS+=("GIT_CONFIG_COUNT=1" "GIT_CONFIG_KEY_0=remote.origin.pushurl" \
           "GIT_CONFIG_VALUE_0=DISABLED_BY_HARNESS_SANDBOX" "GIT_TERMINAL_PROMPT=0")
# 🔴 专用 HOME 是**硬性前置**，不是可选加固。原因（实测，非推演）：
# 外部 CLI 普遍用登录 shell 执行命令（Codex 0.145.0 用 `/bin/zsh -lc`），
# 登录 shell 会 source `~/.zshenv` / `~/.zprofile`——其中任何 `export` 都会把
# env -i 刚剥掉的变量**原样还回子进程**，静默击穿第一道锁。
# 实测：HOME 指向含 `.zshenv` 的目录时，DATABASE_URL / DEPLOY_TOKEN 全部复活。
[ -n "$D_HOME" ] || die "$E_TARGET_ID 未配 sandbox.home_dir —— 子进程会继承真实 HOME，
   其 .zshenv/.zprofile 中的 export 将绕过 env 白名单还原敏感变量（dispatch-mode.md §5.1 L1）。
   请配置专用 HOME，并用 sandbox.env_set 投喂该 CLI 的认证目录（如 CODEX_HOME）。"
case "$D_HOME" in /*) ;; *) die "sandbox.home_dir 必须是绝对路径或 ~ 开头（当前解析为 ${D_HOME}）" ;; esac

# Historical, unreachable Seatbelt scaffold. It is not a strict provider and
# must not be re-enabled without replacing it with the VM/ephemeral-principal
# contract documented in transports/external-bridge-provider.md.
BRIDGE_PRIVATE_STATE_ROOT=""
BRIDGE_TMPDIR=""
SEATBELT_PROFILE=""
SEATBELT_EXEC=""
if [ "$D_TRANSPORT" = "subagent" ]; then
  [ "$(uname -s)" = "Darwin" ] || die "external same-session bridge 需要宿主文件系统隔离 provider；当前仅支持 macOS sandbox-exec"
  SEATBELT_EXEC="/usr/bin/sandbox-exec"
  [ -x "$SEATBELT_EXEC" ] || die "external same-session bridge 需要受信任的 /usr/bin/sandbox-exec，当前主机不可用"
  python3 - "$MAIN_REPO" "$WORKROOT_ABS" "$STATE_ROOT" "$WT" <<'PY' || die "external bridge writable roots 与 Coordinator/state 不得重叠"
import os
import sys

main_repo, workroot, state_root, worktree = (
    os.path.realpath(value) for value in sys.argv[1:5]
)
if os.path.commonpath((main_repo, workroot)) in {main_repo, workroot}:
    raise SystemExit(1)
if os.path.commonpath((state_root, worktree)) in {state_root, worktree}:
    raise SystemExit(1)
PY
  BRIDGE_RUNTIME_ROOT="$(mktemp -d "$WORKROOT_ABS/.bridge-runtime-${E_TASK_ID}.XXXXXX")" \
    || die "同会话 bridge runtime 目录创建失败"
  chmod 700 "$BRIDGE_RUNTIME_ROOT" || die "同会话 bridge runtime 目录权限设置失败"
  BRIDGE_PRIVATE_STATE_ROOT="$BRIDGE_RUNTIME_ROOT/kimi-state"
  BRIDGE_TMPDIR="$BRIDGE_RUNTIME_ROOT/tmp"
  SEATBELT_PROFILE="$BRIDGE_RUNTIME_ROOT/macos-seatbelt.sb"
  BRIDGE_RESULT="$BRIDGE_RUNTIME_ROOT/bridge-result.json"
  mkdir -p "$BRIDGE_PRIVATE_STATE_ROOT" "$BRIDGE_TMPDIR" || die "同会话 bridge runtime 子目录创建失败"
  chmod 700 "$BRIDGE_PRIVATE_STATE_ROOT" "$BRIDGE_TMPDIR" || die "同会话 bridge runtime 子目录权限设置失败"
  # The configured home remains a catalog precondition, but an external bridge
  # receives an empty ephemeral HOME instead of any user-writable directory.
  D_HOME="$BRIDGE_RUNTIME_ROOT/home"
  if ! python3 - "$SEATBELT_PROFILE" "$WT" "$BRIDGE_RUNTIME_ROOT" <<'PY'
import json
import os
import sys

profile_path, worktree, runtime_root = sys.argv[1:4]
writable_roots = [os.path.realpath(value) for value in (worktree, runtime_root)]
if any(not os.path.isabs(value) or value == os.path.sep for value in writable_roots):
    raise SystemExit("invalid bridge writable root")
if os.path.commonpath(writable_roots) in writable_roots:
    raise SystemExit("bridge writable roots must be separate")
profile = "\n".join((
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow file-read*)",
    "(allow network*)",
    *(f"(allow file-write* (subpath {json.dumps(root)}))" for root in writable_roots),
    "",
))
with open(profile_path, "x", encoding="utf-8") as stream:
    stream.write(profile)
os.chmod(profile_path, 0o600)
PY
  then
    die "无法生成 macOS bridge 文件系统隔离 profile"
  fi
fi

mkdir -p "$D_HOME"
# 专用 HOME 里若混入 shell 初始化文件，同一个洞照样重开 —— fail-closed
for dotf in .zshenv .zprofile .zlogin .bashrc .bash_profile .profile .envrc; do
  [ -e "$D_HOME/$dotf" ] && die "专用 HOME 内存在 shell 初始化文件 $D_HOME/$dotf —— 它会在登录 shell 下被 source 并绕过 env 白名单。请移除。"
done
ENV_ARGS+=("HOME=$D_HOME")
echo "[sandbox] 专用 HOME: ${D_HOME}（已确认无 shell 初始化文件）" >&2
if [ -n "$BRIDGE_TMPDIR" ]; then
  ENV_ARGS+=("TMPDIR=$BRIDGE_TMPDIR")
fi
ENV_ARGS+=("HARNESS_ENVELOPE=$ENVELOPE_ABS")
ENV_ARGS+=("HARNESS_ARTIFACT=$E_ARTIFACT" "HARNESS_BATCH=$E_BATCH" "HARNESS_TASK_ID=$E_TASK_ID")
# Do not disclose the Coordinator checkout path to external CLIs. For local-cli
# this remains a cooperative env/worktree convention, not a hostile-process
# filesystem boundary.
ENV_ARGS+=("HARNESS_EFFECTIVE_TIMEOUT_S=$D_TIMEOUT")

# ── 4. 渲染 argv 模板 / 启动已验证 bridge runner ─────────────────────────
ARGV=()
case "$D_TRANSPORT" in
  local-cli)
    for tok in "${D_ARGV_TEMPLATE[@]}"; do
      tok="${tok//\{\{worktree\}\}/$WT}"
      tok="${tok//\{\{envelope\}\}/$ENVELOPE_ABS}"
      # {{envelope_json}}：内联信封**内容**（不是路径），供只接受 `-p <text>` 的 CLI（如 Kimi）。
      # 作为单个 argv 元素直接 exec，无 shell 解释；信封 ~1KB，远低于 ARG_MAX。
      tok="${tok//\{\{envelope_json\}\}/$ENVELOPE_JSON}"
      tok="${tok//\{\{batch\}\}/$E_BATCH}"
      tok="${tok//\{\{artifact\}\}/$E_ARTIFACT}"
      ARGV+=("$tok")
    done
    [ "${#ARGV[@]}" -gt 0 ] || die "local-cli adapter 未生成 argv"
    command -v "${ARGV[0]}" >/dev/null 2>&1 || die "适配器可执行文件不在 PATH：${ARGV[0]}"
    ;;
  subagent)
    [ -n "$D_BRIDGE_ID" ] && [ -n "$D_BRIDGE_STRATEGY" ] && [ -n "$D_BRIDGE_PROTOCOL_JSON" ] && [ -n "$D_AGENT_TYPE" ] || \
      die "同会话 bridge profile 缺少已验证元数据"
    BRIDGE_RUNNER="$DISPATCH_DIR/transports/session-bridge.py"
    [ -f "$BRIDGE_RUNNER" ] || die "同会话 bridge runner 不存在：$BRIDGE_RUNNER"
    [ -n "$BRIDGE_RUNTIME_ROOT" ] && [ -n "$BRIDGE_RESULT" ] && [ -n "$BRIDGE_PRIVATE_STATE_ROOT" ] || \
      die "同会话 bridge 缺少受控 runtime 目录"
    [ ! -e "$BRIDGE_RESULT" ] || die "task_id 已有 bridge 回执：$BRIDGE_RESULT"
    ARGV=(
      python3 "$BRIDGE_RUNNER" run
      --bridge-id "$D_BRIDGE_ID" --strategy "$D_BRIDGE_STRATEGY"
      --protocol-json "$D_BRIDGE_PROTOCOL_JSON" --persona "$D_AGENT_TYPE"
      --envelope "$ENVELOPE_ABS" --worktree "$WT" --result "$BRIDGE_RESULT"
      --timeout-s "$D_TIMEOUT" --private-state-root "$BRIDGE_PRIVATE_STATE_ROOT"
    )
    ;;
  *) die "未知 sandbox transport：$D_TRANSPORT" ;;
esac

# ── 5. 绝对 wall-clock 封顶执行（单一 portable helper）────────────────────
LOG="$(cd "$WORKROOT" && pwd)/run-${E_TASK_ID}.log"
TIMEOUT_STATUS="$(cd "$WORKROOT" && pwd)/timeout-${E_TASK_ID}.json"
START=$(date +%s)
HELPER_PID=""
forward_signal() {
  local sig="$1"
  [ -n "$HELPER_PID" ] && kill -"$sig" "$HELPER_PID" 2>/dev/null || true
}
trap 'forward_signal TERM' TERM
trap 'forward_signal INT' INT
wait_for_helper() {
  local rc=0
  while true; do
    wait "$HELPER_PID" || rc=$?
    kill -0 "$HELPER_PID" 2>/dev/null || return "$rc"
  done
}
set +e
# 子进程一律在 worktree 内启动（子 shell cd，不影响本脚本）。
# 不依赖各家 CLI 的 --cd/-C 是否存在、是否被遵守；Kimi 无此类参数，完全靠这条。
# 封顶对每种投递方式都必须生效。env 只通过 HARNESS_ENVELOPE 交付，argv
# 只通过适配器模板交付；两者都不应意外继承调用方 stdin。
run_timeout_helper() {
  if [ "$D_TRANSPORT" = "subagent" ]; then
    [ -n "$SEATBELT_EXEC" ] && [ -n "$SEATBELT_PROFILE" ] && [ -n "$BRIDGE_TMPDIR" ] || \
      die "同会话 bridge 缺少宿主文件系统隔离"
    # The deadline helper stays outside Seatbelt as the trusted group reaper.
    # The contained bridge inherits that group rather than starting another
    # session, so it needs no broad signal permission and cannot strand Kimi
    # after cancellation or normal bridge completion.
    exec python3 "$TIMEOUT_HELPER" --timeout "$D_TIMEOUT" --term-grace 2 --status-file "$TIMEOUT_STATUS" --cwd "$WT" -- \
      env -i "${ENV_ARGS[@]}" "HARNESS_BRIDGE_OUTER_GROUP_CLEANUP=1" \
      "$SEATBELT_EXEC" -f "$SEATBELT_PROFILE" "${ARGV[@]}"
  fi
  exec python3 "$TIMEOUT_HELPER" --timeout "$D_TIMEOUT" --term-grace 2 --status-file "$TIMEOUT_STATUS" --cwd "$WT" -- \
    env -i "${ENV_ARGS[@]}" "${ARGV[@]}"
}
case "$D_ENVELOPE_DELIVERY" in
  stdin)
    ( cd "$WT" && run_timeout_helper < "$ENVELOPE_ABS" > "$LOG" 2>&1 ) &
    ;;
  argv|env)
    ( cd "$WT" && run_timeout_helper < /dev/null > "$LOG" 2>&1 ) &
    ;;
  *)
    die "适配器 envelope_delivery 非法：$D_ENVELOPE_DELIVERY"
    ;;
esac
HELPER_PID=$!
wait_for_helper
EXIT=$?
trap - TERM INT
set -e
DURATION=$(( $(date +%s) - START ))

# ── 6. 回执原始事实（不做语义判定）─────────────────────────────────────────
ARTIFACT_ABS="$WT/$E_ARTIFACT"
TERMINATION_REASON="$(python3 - "$TIMEOUT_STATUS" <<'PY'
import json, sys
try: print(json.load(open(sys.argv[1])).get("reason") or "unknown")
except Exception: print("unknown")
PY
)"
if   [ "$EXIT" -eq 124 ] && [ "$TERMINATION_REASON" = deadline ]; then OUTCOME="TIMEOUT"
elif [ "$TERMINATION_REASON" = external_signal ];       then OUTCOME="CANCELED"
elif [ "$EXIT" -ne 0 ];                          then OUTCOME="FAILED"
elif [ ! -f "$ARTIFACT_ABS" ];                   then OUTCOME="ARTIFACT_MISSING"
else                                                  OUTCOME="RETURNED"
fi

# A process exit and an artifact are not enough for a same-session bridge:
# the generic runner must also prove the declared bridge reached its child
# terminal state in the same session.  The persisted object contains only
# scalar protocol lineage and an artifact hash; it never contains prompts,
# model output, credentials, or raw ACP/App Server messages.
BRIDGE_META_JSON="null"
if [ "$D_TRANSPORT" = "subagent" ] && [ "$EXIT" -eq 0 ]; then
  set +e
  BRIDGE_META_JSON="$(python3 - "$BRIDGE_RESULT" "$D_BRIDGE_ID" "$D_BRIDGE_STRATEGY" "$D_BRIDGE_PROTOCOL_JSON" "$ARTIFACT_ABS" <<'PY'
import hashlib
import json
import os
import re
import sys

result_path, bridge_id, strategy, protocol_json, artifact = sys.argv[1:6]
try:
    protocol = json.loads(protocol_json)
    result = json.load(open(result_path, encoding="utf-8"))
except (OSError, TypeError, ValueError) as exc:
    raise SystemExit("bridge result is unreadable")
if not isinstance(protocol, dict) or not isinstance(result, dict):
    raise SystemExit("bridge result shape is invalid")
kind = protocol.get("kind")
allowed = {
    "acp-native-agent/v1": {
        "bridge_id", "bridge_strategy", "bridge_kind", "session_scope",
        "session_id", "child_call_id", "terminal_status", "artifact_sha256",
    },
}
if kind not in allowed or set(result) != allowed[kind]:
    raise SystemExit("bridge result contains invalid fields")
if result.get("bridge_id") != bridge_id or result.get("bridge_strategy") != strategy:
    raise SystemExit("bridge result declaration does not match target")
if result.get("bridge_kind") != kind or result.get("session_scope") != "same-session":
    raise SystemExit("bridge result session scope is invalid")
if result.get("terminal_status") != "completed":
    raise SystemExit("bridge child did not complete")
lineage_id = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")
if not isinstance(result.get("session_id"), str) or lineage_id.fullmatch(result["session_id"]) is None:
    raise SystemExit("bridge session identifier is invalid")
if not isinstance(result.get("child_call_id"), str) or re.fullmatch(r"[0-9a-f]{64}", result["child_call_id"]) is None:
    raise SystemExit("bridge child-call receipt token is invalid")
digest = hashlib.sha256()
with open(artifact, "rb") as stream:
    for block in iter(lambda: stream.read(1024 * 1024), b""):
        digest.update(block)
if result.get("artifact_sha256") != digest.hexdigest():
    raise SystemExit("bridge artifact hash does not match")
print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
PY
)"
  BRIDGE_RC=$?
  set -e
  if [ "$BRIDGE_RC" -ne 0 ]; then
    BRIDGE_META_JSON="null"
    OUTCOME="FAILED"
    TERMINATION_REASON="bridge_proof_invalid"
  fi
fi

# Planner and Evaluator may return exactly their commissioned artifact, never
# source edits. Host containment keeps writes away from the Coordinator checkout;
# this receipt check additionally rejects a bridge child that dirtied its own
# isolated worktree before any artifact can enter the Coordinator flow.
if [ "$D_TRANSPORT" = "subagent" ] && [ "$EXIT" -eq 0 ] && [ "$OUTCOME" = "RETURNED" ] && [ "$E_ROLE" != "generator" ]; then
  set +e
  python3 - "$WT" "$E_ARTIFACT" >/dev/null 2>&1 <<'PY'
import os
import subprocess
import sys
from pathlib import Path

worktree = Path(sys.argv[1]).resolve()
artifact_rel = sys.argv[2]
artifact = worktree / artifact_rel
try:
    artifact.lstat()
except OSError:
    raise SystemExit(1)
if artifact.is_symlink() or not artifact.is_file() or artifact.stat().st_nlink != 1:
    raise SystemExit(1)

for command in (
    ["git", "-C", str(worktree), "diff", "--no-ext-diff", "--quiet"],
    ["git", "-C", str(worktree), "diff", "--cached", "--no-ext-diff", "--quiet"],
):
    result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if result.returncode != 0:
        raise SystemExit(1)

untracked = subprocess.run(
    ["git", "-C", str(worktree), "ls-files", "--others", "--exclude-standard", "-z"],
    stdout=subprocess.PIPE,
    stderr=subprocess.DEVNULL,
    check=False,
).stdout.split(b"\0")
entries = [item.decode("utf-8", "strict") for item in untracked if item]
if entries != [artifact_rel]:
    raise SystemExit(1)
PY
  READONLY_RC=$?
  set -e
  if [ "$READONLY_RC" -ne 0 ]; then
    BRIDGE_META_JSON="null"
    OUTCOME="FAILED"
    TERMINATION_REASON="readonly_worktree_mutation"
  fi
fi

META="$STATE_ROOT/run-meta-${E_TASK_ID}.json"
python3 - "$META" "$E_TASK_ID" "$E_TARGET_ID" "$D_ADAPTER" "$D_FAMILY" "$E_ROLE" "$E_DELIVERABLE" \
                  "$E_BATCH" "$WT" "$ARTIFACT_ABS" "$LOG" "$OUTCOME" "$EXIT" "$DURATION" "$REF" \
                  "$D_TIMEOUT" "$D_TIMEOUT_CAP" "$TERMINATION_REASON" "$ENVELOPE_ABS" "$D_TRANSPORT" "$BRIDGE_META_JSON" <<'PY'
import json, sys
p, task, agent, adapter, family, role, deliverable_json, batch, wt, art, log, outcome, code, dur, ref, effective, cap, reason, envelope_path, transport, bridge_json = sys.argv[1:22]
try:
    deliverable = json.loads(deliverable_json)
except (TypeError, ValueError):
    deliverable = {}
try:
    bridge = json.loads(bridge_json)
except (TypeError, ValueError):
    bridge = None
meta = {"task_id": task, "agent_id": agent, "adapter": adapter, "model_family": family,
        "role": role, "deliverable": deliverable,
        "batch": batch, "ref": ref, "worktree": wt, "artifact": art, "log": log,
        "envelope_path": envelope_path,
        "outcome": outcome, "exit_code": int(code), "duration_s": int(dur),
        "effective_timeout_s": int(effective), "descriptor_timeout_s": int(cap),
        "termination_reason": reason, "transport": transport}
if isinstance(bridge, dict):
    meta["bridge"] = bridge
json.dump(meta, open(p, "w"), ensure_ascii=False, indent=2)
print(json.dumps(meta, ensure_ascii=False))
PY

echo "[sandbox] outcome=$OUTCOME exit=$EXIT ${DURATION}s · log=$LOG" >&2
# 清理命令按沙箱形态给：克隆是普通目录（worktree remove 对它无效，会报「不是 worktree」）
if [ "${D_WRITE_SRC:-false}" = true ]; then
  echo "[sandbox] 取证后清理：rm -rf '$WT'（write_src 用的是独立克隆，不是 worktree）" >&2
else
  echo "[sandbox] 取证后清理：git worktree remove --force '$WT'" >&2
fi
[ "$OUTCOME" = "TIMEOUT" ] && exit 124
[ "$OUTCOME" = "CANCELED" ] && exit "$EXIT"
exit 0
