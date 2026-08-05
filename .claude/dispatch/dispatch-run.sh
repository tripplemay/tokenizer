#!/usr/bin/env bash
# dispatch-mode.md 统一派活入口 —— 按 descriptor.transport 路由，对上层隐藏 transport 差异。
#
#   local-cli → sandbox-profile.sh（本机 fork 子进程，阻塞）
#   subagent  → host-native 由 Coordinator 直派；外部 bridge 仅走受管 VM provider
#   a2a       → a2a-client.py run（远端 runner，SSE 订阅至终态）
#
# 两条路径**输出同形的 run-meta JSON 到 stdout**，于是回执推断表、gate-arbiter、/autodrive
# 一行都不用改。这正是当初把「车道」降级为 transport 字段的回报。
#
# 用法：dispatch-run.sh --agent <id> --envelope <f> [--registry f] [--workroot d] [--state d]
# 输出：stdout 只有 run-meta JSON；进度与告警走 stderr。
# 退出码：0 子进程/任务正常收敛（语义判定归 validate-dispatch.sh receipt）· 2 前置失败 · 124 超时

set -euo pipefail

REGISTRY=".agents-registry.json"
DISPATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE_ADAPTERS="$DISPATCH_DIR/resolve-mode-adapters.sh"
WORKROOT="../.harness-dispatch"
STATE=".harness-dispatch"
PROGRESS="progress.json"
PROGRESS_EXPLICIT=false
PUB=""
ADAPTERS=""
AGENT_ID=""; ENVELOPE=""; EXTRA=()

while [ $# -gt 0 ]; do
  case "$1" in
    --agent)    AGENT_ID="$2"; shift 2 ;;
    --envelope) ENVELOPE="$2"; shift 2 ;;
    --registry) REGISTRY="$2"; shift 2 ;;
    --workroot) WORKROOT="$2"; shift 2 ;;
    --state)    STATE="$2"; shift 2 ;;
    --progress) PROGRESS="$2"; PROGRESS_EXPLICIT=true; shift 2 ;;
    --pub)      PUB="$2"; shift 2 ;;
    --adapters) ADAPTERS="$2"; shift 2 ;;
    *) EXTRA+=("$1"); shift ;;
  esac
done

die() { echo "[dispatch-run] ⛔ $1" >&2; exit 2; }
[ -n "$AGENT_ID" ] || die "缺 --agent"
[ -n "$ENVELOPE" ] || die "缺 --envelope"
[ -f "$ENVELOPE" ] || die "信封不存在：${ENVELOPE}"
[ -n "$REGISTRY" ] || die "缺 --registry"

# 信封白名单校验前置到这里，两条 transport 共用（铁律 12 的机械强制）
bash "$DISPATCH_DIR/validate-dispatch.sh" envelope "$ENVELOPE" >&2 || die "信封校验未过，不派活"
# 本地 repo.url 必须与调用入口所在 git 仓一致。此检查发生在任何 state/workroot 目录创建之前。
PROJECT_ROOT="$(python3 "$DISPATCH_DIR/dispatch_common.py" repo-preflight \
  --envelope "$ENVELOPE" --cwd "$PWD")" || die "repo.url 前置校验未过，不派活"
# Registry controls transport and bridge launch metadata. Pin it to the
# invocation repository before any adapter/catalog or stateful dispatch work.
REGISTRY="$(python3 "$DISPATCH_DIR/dispatch_common.py" project-registry \
  --project-root "$PROJECT_ROOT" --registry "$REGISTRY")" \
  || die "注册表必须是项目根的非符号链接 .agents-registry.json"

# A generic dispatch utility is also used by isolated fixtures that have no
# progress state. Inside a real project, however, an active v2 checkpoint owns
# the role selection: a caller-provided --agent may only equal the freshly
# re-verified record for the envelope role. This applies equally to manually
# invoked planner/generator/evaluator dispatches.
ROLE="$(python3 - "$ENVELOPE" <<'PY'
import json
import sys
try:
    print(json.load(open(sys.argv[1], encoding="utf-8")).get("role") or "")
except (OSError, ValueError) as exc:
    raise SystemExit(f"[dispatch-run] ⛔ 无法读取已校验 envelope role：{exc}")
PY
)" || die "无法读取 envelope role"
CANONICAL_PROGRESS="$PROJECT_ROOT/progress.json"
ACTIVE_PROGRESS=""
ACTIVE_RECORD="{}"
if [ -f "$CANONICAL_PROGRESS" ]; then
  if [ "$PROGRESS_EXPLICIT" = true ]; then
    PROVIDED_PROGRESS="$(python3 - "$PROGRESS" <<'PY'
import os
import sys
print(os.path.realpath(sys.argv[1]))
PY
)"
    [ "$PROVIDED_PROGRESS" = "$CANONICAL_PROGRESS" ] || die "--progress 必须是项目根 canonical progress.json"
  fi
  ACTIVE_PROGRESS="$CANONICAL_PROGRESS"
elif [ "$PROGRESS_EXPLICIT" = true ]; then
  die "显式 --progress 不存在，不能跳过 active mode 校验：$PROGRESS"
fi

# Resolve the one adapter directory owned by this active batch before any
# registry/catalog lookup. A caller may name it explicitly only as an equality
# assertion; the durable checkpoint remains the authority.
if [ -n "$ACTIVE_PROGRESS" ]; then
  [ -x "$MODE_ADAPTERS" ] || die "resolve-mode-adapters.sh 不存在或不可执行"
  MODE_ADAPTER_ARGS=(--progress "$ACTIVE_PROGRESS" --default "$DISPATCH_DIR/transports/adapters")
  [ -z "$ADAPTERS" ] || MODE_ADAPTER_ARGS+=(--adapters "$ADAPTERS")
  ADAPTERS="$(bash "$MODE_ADAPTERS" "${MODE_ADAPTER_ARGS[@]}")" \
    || die "无法恢复 active mode 的 adapter 目录"
else
  ADAPTERS="${ADAPTERS:-$DISPATCH_DIR/transports/adapters}"
  [ -d "$ADAPTERS" ] || die "适配器目录不存在：$ADAPTERS"
  ADAPTERS="$(python3 - "$ADAPTERS" <<'PY'
import os
import sys
print(os.path.realpath(sys.argv[1]))
PY
)"
fi

# The registry is part of the execution contract too. In particular, it
# rejects a2a+generator before a transport can claim source changes are
# returnable without a source-handoff protocol.
bash "$DISPATCH_DIR/validate-dispatch.sh" registry "$REGISTRY" \
  --progress "${ACTIVE_PROGRESS:-$PROJECT_ROOT/progress.json}" --adapters "$ADAPTERS" >&2 \
  || die "注册表校验未过，不派活"

if [ -n "$ACTIVE_PROGRESS" ]; then
  ACTIVE_ARGS=(--role "$ROLE" --expected-agent "$AGENT_ID" --progress "$ACTIVE_PROGRESS" --registry "$REGISTRY")
  ACTIVE_ARGS+=(--adapters "$ADAPTERS")
  [ -z "$PUB" ] || ACTIVE_ARGS+=(--pub "$PUB")
  ACTIVE_RECORD="$(bash "$DISPATCH_DIR/resolve-active-mode-role.sh" "${ACTIVE_ARGS[@]}")" \
    || die "active mode role 复验失败；拒绝使用未验证的 --agent"
fi

TARGET_ARGS=(python3 "$DISPATCH_DIR/tool-catalog.py" target --registry "$REGISTRY" --target-id "$AGENT_ID")
TARGET_ARGS+=(--adapters "$ADAPTERS")
TARGET_JSON="$("${TARGET_ARGS[@]}")" || die "内部执行目标不存在或不再满足安全策略"
# ``resolve-active-mode-role`` replays the signed checkpoint and produces the
# current catalog record. Re-resolve once more immediately before transport,
# then carry its semantic digest down to the execution entrypoint so a mutable
# registry/bridge/adapter cannot drift between these reads.
EXPECTED_PROVENANCE="$(python3 - "$ACTIVE_RECORD" "$TARGET_JSON" <<'PY'
import json
import re
import sys

active_raw, target_raw = sys.argv[1:3]
fields = {
    "agent_id", "tool", "invocation", "model_family", "priority",
    "execution_provenance_sha256",
}
sha256 = re.compile(r"[0-9a-f]{64}\Z")


def fail(message):
    print(f"[dispatch-run] ⛔ {message}", file=sys.stderr)
    raise SystemExit(2)


try:
    active = json.loads(active_raw)
    target = json.loads(target_raw)
except (TypeError, ValueError) as exc:
    fail(f"active resolution 或 target JSON 非法：{exc}")
if active == {}:
    print("")
    raise SystemExit(0)
if not isinstance(active, dict) or set(active) != fields:
    fail("active resolution 必须恰含六字段（含 execution_provenance_sha256）")
if not isinstance(active.get("execution_provenance_sha256"), str) or not sha256.fullmatch(active["execution_provenance_sha256"]):
    fail("active execution_provenance_sha256 必须是小写 SHA-256")
if not isinstance(target, dict):
    fail("内部 execution target 必须是 object")
if target.get("target_id") != active["agent_id"]:
    fail("内部 execution target 与 active agent_id 不一致")
actual = target.get("execution_provenance_sha256")
if not isinstance(actual, str) or not sha256.fullmatch(actual):
    fail("内部 execution target 缺合法 execution_provenance_sha256")
if actual != active["execution_provenance_sha256"]:
    fail("执行目标语义已漂移；重新 /plan 并 consume 后才能派活")
print(actual)
PY
)" || die "active execution provenance 复验失败"
if ! TRANSPORT="$(python3 - "$TARGET_JSON" "$ROLE" <<'PY'
import json
import sys

try:
    target = json.loads(sys.argv[1])
except (TypeError, ValueError) as exc:
    print(f"[dispatch-run] ⛔ 内部执行目标 JSON 非法：{exc}", file=sys.stderr)
    raise SystemExit(2)
role = sys.argv[2]
if not isinstance(target, dict):
    raise SystemExit("[dispatch-run] ⛔ 内部执行目标必须为 object")
roles = target.get("roles")
transport = target.get("invocation")
if not isinstance(roles, list) or role not in roles:
    raise SystemExit(f"[dispatch-run] ⛔ target roles={roles!r} 不含信封 role={role!r}")
if transport not in ("subagent", "local-cli", "a2a"):
    raise SystemExit(f"[dispatch-run] ⛔ target invocation 非法：{transport!r}")
if role == "generator" and transport == "a2a":
    raise SystemExit(
        "[dispatch-run] ⛔ a2a transport 暂不支持 generator："
        "尚无 source-handoff protocol，不能安全回流源码改动"
    )
print(transport)
PY
)"; then
  die "内部执行目标与信封角色不兼容"
fi

case "$TRANSPORT" in
  local-cli)
    echo "[dispatch-run] transport=local-cli → 本机沙箱" >&2
    LOCAL_ARGS=(
      --agent "$AGENT_ID" --envelope "$ENVELOPE"
      --registry "$REGISTRY" --workroot "$WORKROOT" --state "$STATE"
    )
    LOCAL_ARGS+=(--adapters "$ADAPTERS")
    [ -z "$EXPECTED_PROVENANCE" ] || LOCAL_ARGS+=(--expected-provenance "$EXPECTED_PROVENANCE")
    if [ "${#EXTRA[@]}" -gt 0 ]; then
      LOCAL_ARGS+=("${EXTRA[@]}")
    fi
    exec bash "$DISPATCH_DIR/sandbox-profile.sh" "${LOCAL_ARGS[@]}"
    ;;
  a2a)
    echo "[dispatch-run] transport=a2a → 远端 runner（SSE 订阅至终态）" >&2
    A2A_ARGS=(
      run --agent "$AGENT_ID" --envelope "$ENVELOPE"
      --registry "$REGISTRY" --adapters "$ADAPTERS" --state "$STATE" --project-root "$PROJECT_ROOT"
    )
    [ -z "$EXPECTED_PROVENANCE" ] || A2A_ARGS+=(--expected-provenance "$EXPECTED_PROVENANCE")
    if [ "${#EXTRA[@]}" -gt 0 ]; then
      A2A_ARGS+=("${EXTRA[@]}")
    fi
    exec python3 "$DISPATCH_DIR/transports/a2a-client.py" "${A2A_ARGS[@]}"
    ;;
  subagent)
    if ! SUBAGENT_ROUTE="$(python3 - "$TARGET_JSON" "$AGENT_ID" "$ROLE" "$EXPECTED_PROVENANCE" <<'PY'
import json
import re
import sys

target_raw, agent_id, role, expected_provenance = sys.argv[1:5]
safe_id = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
sha256 = re.compile(r"[0-9a-f]{64}\Z")


def reject_duplicates(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"duplicate JSON key {key!r}")
        value[key] = item
    return value


try:
    target = json.loads(target_raw, object_pairs_hook=reject_duplicates)
except (TypeError, ValueError) as exc:
    raise SystemExit(f"[dispatch-run] ⛔ subagent target JSON 非法：{exc}")
if not isinstance(target, dict):
    raise SystemExit("[dispatch-run] ⛔ subagent target 必须是 object")
if target.get("target_id") != agent_id or role not in target.get("roles", []):
    raise SystemExit("[dispatch-run] ⛔ subagent target 未绑定本次 agent/role")
bridge_id = target.get("bridge_id")
if bridge_id == "host-native":
    print("host-native")
    raise SystemExit(0)
protocol = target.get("bridge_protocol")
if (
    not isinstance(bridge_id, str)
    or safe_id.fullmatch(bridge_id) is None
    or not isinstance(target.get("bridge_strategy"), str)
    or safe_id.fullmatch(target["bridge_strategy"]) is None
    or target.get("session_scope") != "same-session"
    or target.get("bridge_provider_id") != "harness-vm-v1"
    or target.get("bridge_provider_kind") != "vm-v1"
    or not isinstance(target.get("bridge_provider_contract_sha256"), str)
    or sha256.fullmatch(target["bridge_provider_contract_sha256"]) is None
    or not isinstance(target.get("execution_provenance_sha256"), str)
    or sha256.fullmatch(target["execution_provenance_sha256"]) is None
    or not isinstance(expected_provenance, str)
    or sha256.fullmatch(expected_provenance) is None
    or target["execution_provenance_sha256"] != expected_provenance
    or not isinstance(protocol, dict)
    or set(protocol) != {"kind", "command", "request_delivery", "response_format"}
    or protocol.get("kind") != "acp-native-agent/v1"
    or protocol.get("request_delivery") != "stdin"
    or protocol.get("response_format") != "json"
    or not isinstance(protocol.get("command"), list)
    or not protocol["command"]
    or any(not isinstance(item, str) or not item for item in protocol["command"])
):
    raise SystemExit("[dispatch-run] ⛔ subagent target 不是已签发的 vm-v1 external bridge")
print("external-vm-v1")
PY
)"; then
      die "无法判断 subagent bridge 路径"
    fi
    if [ "$SUBAGENT_ROUTE" = "host-native" ]; then
      die "$AGENT_ID 的 transport=subagent 是当前 Coordinator 的 host-native 路径；由编排者直接派，不走本入口"
    fi
    if [ "${#EXTRA[@]}" -gt 0 ]; then
      die "external vm-v1 bridge 不接受未声明的 dispatch 参数"
    fi
    [ "$SUBAGENT_ROUTE" = "external-vm-v1" ] || die "未知 subagent bridge 路径"
    [ -n "$ACTIVE_PROGRESS" ] || die "external vm-v1 bridge 必须由已验签 active mode 签发"
    [ -n "$EXPECTED_PROVENANCE" ] || die "external vm-v1 bridge 缺少已签发 execution provenance"
    # The project copy is a managed compatibility mirror, never the provider
    # trust root.  Resolve the installed Tokenizer application through the
    # account database rather than HOME/PATH/registry/lock data, and execute
    # only its framework bundle.  A pre-release or drifted installation fails
    # closed; it cannot nominate a project-local replacement.
    if ! VM_PROVIDER="$(/usr/bin/python3 -I - "$PROJECT_ROOT" <<'PY'
import hashlib
import os
import pwd
import stat
import sys
from pathlib import Path

try:
    home = Path(pwd.getpwuid(os.geteuid()).pw_dir)
except (KeyError, OSError):
    raise SystemExit(2)
project_root = Path(sys.argv[1])
root = home / ".tokenizer" / "app"
required = (
    "tool-catalog.py",
    "dispatch_common.py",
    "validate-active-return-route.py",
    "transports/vm-bridge-provider.py",
    "transports/session-bridge.py",
    "transports/session_bridge_kimi.py",
    "transports/vm-bridge-worker.py",
)
current = root
for segment in ("framework", "templates", "claude", "dispatch"):
    try:
        current_entry = current.lstat()
    except OSError:
        raise SystemExit(2)
    if (
        stat.S_ISLNK(current_entry.st_mode)
        or not stat.S_ISDIR(current_entry.st_mode)
        or current_entry.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
    ):
        raise SystemExit(2)
    current = current / segment
try:
    current_entry = current.lstat()
except OSError:
    raise SystemExit(2)
if (
    stat.S_ISLNK(current_entry.st_mode)
    or not stat.S_ISDIR(current_entry.st_mode)
    or current_entry.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
):
    raise SystemExit(2)

def identical(left, right):
    try:
        left_entry, right_entry = left.lstat(), right.lstat()
    except OSError:
        return False
    if (
        stat.S_ISLNK(left_entry.st_mode)
        or stat.S_ISLNK(right_entry.st_mode)
        or not stat.S_ISREG(left_entry.st_mode)
        or not stat.S_ISREG(right_entry.st_mode)
        or left_entry.st_size != right_entry.st_size
    ):
        return False
    digest = hashlib.sha256()
    try:
        with left.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        left_hash = digest.digest()
        digest = hashlib.sha256()
        with right.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
    except OSError:
        return False
    return left_hash == digest.digest()

app_dispatch = root / "framework" / "templates" / "claude" / "dispatch"
project_dispatch = project_root / ".claude" / "dispatch"
for relative in required:
    parent = app_dispatch
    for segment in Path(relative).parts[:-1]:
        parent = parent / segment
        try:
            parent_entry = parent.lstat()
        except OSError:
            raise SystemExit(2)
        if (
            stat.S_ISLNK(parent_entry.st_mode)
            or not stat.S_ISDIR(parent_entry.st_mode)
            or parent_entry.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
        ):
            raise SystemExit(2)
    candidate = app_dispatch / relative
    try:
        entry = candidate.lstat()
    except OSError:
        raise SystemExit(2)
    if stat.S_ISLNK(entry.st_mode) or not stat.S_ISREG(entry.st_mode):
        raise SystemExit(2)
    if entry.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
        raise SystemExit(2)
    if not identical(project_dispatch / relative, candidate):
        raise SystemExit(2)
print(app_dispatch / "transports/vm-bridge-provider.py")
PY
)"; then
      die "未找到受信任的 Tokenizer app VM provider bundle；更新安装 Agent 后重试"
    fi
    STATE_ABS="$(python3 - "$PROJECT_ROOT" "$STATE" <<'PY'
import os
import sys

root, value = sys.argv[1:3]
print(os.path.abspath(value if os.path.isabs(value) else os.path.join(root, value)))
PY
)" || die "无法解析 external vm-v1 provider state 路径"
    echo "[dispatch-run] transport=subagent bridge → framework VM provider" >&2
    cd "$PROJECT_ROOT"
    exec /usr/bin/python3 -I "$VM_PROVIDER" launch \
      --agent "$AGENT_ID" --envelope "$ENVELOPE" --registry "$REGISTRY" \
      --adapters "$ADAPTERS" --project-root "$PROJECT_ROOT" --state "$STATE_ABS" \
      --expected-provenance "$EXPECTED_PROVENANCE"
    ;;
  "")
    die "注册表中无此 agent 或未声明 transport：$AGENT_ID"
    ;;
  *)
    die "未知 transport：$TRANSPORT"
    ;;
esac
