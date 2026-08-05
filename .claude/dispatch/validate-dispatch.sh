#!/usr/bin/env bash
# dispatch-mode.md 的 fail-closed 校验器。四种用途，一个入口：
#
#   validate-dispatch.sh registry    [.agents-registry.json] [--progress progress.json] [--adapters <dir>]
#                                                              L1 descriptor 合法性
#   validate-dispatch.sh envelope    <envelope.json>                L2 信封（字段白名单 = 铁律 12 强制）
#   validate-dispatch.sh assignments [progress.json] [registry] [--adapters <dir>]
#                                                              ⚠️ 独立性互斥：generator/evaluator 的 model_family 必须不同
#   validate-dispatch.sh receipt     <run-meta.json> [--expected-envelope <f> --active-role-json <json> --active-target-json <json> --project-root <dir>]
#                                                              L3 回执推断（external subagent 必须带已验签 role/target 上下文）
#   validate-dispatch.sh hook                                       PostToolUse：stdin 取 file_path，命中即校验
#
# 退出码：0 通过 / 2 校验失败（fail-closed）
#         receipt 模式另有：3 = 需人类（AUTH_REQUIRED / INPUT_REQUIRED）· 4 = 可重派（FAILED / CANCELED / ARTIFACT_INVALID）
#
# 不依赖 jsonschema 库（与 validate-verdict-artifact.sh 一致，手写校验保证零依赖可跑）。

set -euo pipefail
MODE="${1:-all}"
DISPATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE_ADAPTERS="$DISPATCH_DIR/resolve-mode-adapters.sh"
EXTERNAL_RECEIPT_VALIDATOR="$DISPATCH_DIR/validate-external-bridge-receipt.py"
ACTIVE_RETURN_ROUTE_VALIDATOR="$DISPATCH_DIR/validate-active-return-route.py"

resolve_active_adapters() {
  local progress_path="$1"
  local requested="$2"
  local default_adapters="$DISPATCH_DIR/transports/adapters"
  local args=(--progress "$progress_path" --default "$default_adapters")
  [ -z "$requested" ] || args+=(--adapters "$requested")
  [ -x "$MODE_ADAPTERS" ] || {
    echo "[dispatch] ⛔ resolve-mode-adapters.sh 不存在或不可执行" >&2
    return 2
  }
  if [ -f "$progress_path" ]; then
    bash "$MODE_ADAPTERS" "${args[@]}"
    return
  fi
  local selected="${requested:-$default_adapters}"
  [ -d "$selected" ] || {
    echo "[dispatch] ⛔ 适配器目录不存在：$selected" >&2
    return 2
  }
  python3 - "$selected" <<'PY'
import os
import sys
print(os.path.realpath(sys.argv[1]))
PY
}

# ── PostToolUse hook：从 stdin 的 tool_input 取 file_path，命中相关文件才校验 ──
if [ "$MODE" = "hook" ]; then
  INPUT=$(cat)
  FP=$(printf '%s' "$INPUT" | python3 -c "
import json,sys
try: print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))
except Exception: pass
")
  # Registry contents choose transports and executable metadata.  A hook event
  # must not make an arbitrary same-named file (or a symlink) an authority that
  # the execution entries would reject later.  Keep this early configuration
  # guard on the exact same project-root pinning primitive as dispatch-run.
  PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
    echo "[dispatch] ⛔ PostToolUse dispatch hook 必须在 git 项目内运行" >&2
    exit 2
  }
  pin_hook_registry() {
    python3 "$DISPATCH_DIR/dispatch_common.py" project-registry \
      --project-root "$PROJECT_ROOT" --registry "$1"
  }
  validate_hook_state() {
    local registry="$1"
    "$0" registry "$registry" --progress "$PROJECT_ROOT/progress.json" || return 2
    "$0" assignments "$PROJECT_ROOT/progress.json" "$registry" || return 2
    "$DISPATCH_DIR/validate-resolved-mode-bindings.sh" \
      --progress "$PROJECT_ROOT/progress.json" --registry "$registry" >/dev/null || return 2
  }
  case "$(basename "$FP" 2>/dev/null)" in
    .agents-registry.json)
      REGISTRY="$(pin_hook_registry "$FP")" || exit 2
      validate_hook_state "$REGISTRY" || exit 2
      exit 0
      ;;
    progress.json)
      CANDIDATE="$PROJECT_ROOT/.agents-registry.json"
      # Include dangling links so a broken attempted registry is rejected
      # rather than silently treated as an absent configuration.
      if [ -e "$CANDIDATE" ] || [ -L "$CANDIDATE" ]; then
        REGISTRY="$(pin_hook_registry "$CANDIDATE")" || exit 2
        validate_hook_state "$REGISTRY" || exit 2
      fi
      exit 0
      ;;
    *) exit 0 ;;
  esac
fi

case "$MODE" in

registry)
  shift
  REG=".agents-registry.json"
  if [ "${1:-}" != "" ] && [ "${1#--}" = "$1" ]; then
    REG="$1"
    shift
  fi
  PROGRESS="${HARNESS_PROGRESS:-progress.json}"
  REQUESTED_ADAPTERS=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --adapters)
        [ "$#" -ge 2 ] || { echo "[dispatch] ⛔ registry --adapters 缺值"; exit 2; }
        REQUESTED_ADAPTERS="$2"
        shift 2
        ;;
      --progress)
        [ "$#" -ge 2 ] || { echo "[dispatch] ⛔ registry --progress 缺值"; exit 2; }
        PROGRESS="$2"
        shift 2
        ;;
      *)
        # Keep the historical positional adapter directory accepted by the
        # old registry entrypoint while new callers use the explicit flag.
        if [ -z "$REQUESTED_ADAPTERS" ] && [ "${1#--}" = "$1" ]; then
          REQUESTED_ADAPTERS="$1"
          shift
        else
          echo "[dispatch] ⛔ registry 未知参数：$1"
          exit 2
        fi
        ;;
    esac
  done
  [ -f "$REG" ] || { echo "[dispatch] ⛔ 注册表不存在：$REG"; exit 2; }
  ADAPTERS="$(resolve_active_adapters "$PROGRESS" "$REQUESTED_ADAPTERS")" || exit 2
  python3 - "$REG" "$DISPATCH_DIR" "$ADAPTERS" <<'PY'
import json, os, re, subprocess, sys
p, dispatch_dir, adapters_dir = sys.argv[1:4]
sys.path.insert(0, dispatch_dir)
from dispatch_common import (
    A2A_AUTH_UNSET,
    DispatchContractError,
    a2a_auth_config,
    effective_timeout,
    external_environment_allowlist,
    external_environment_set,
)
try: reg = json.load(open(p))
except Exception as e: print(f"[dispatch] ⛔ 注册表 JSON 非法：{e}"); sys.exit(2)

# tool-integrations/1 intentionally stores neutral CLI integrations rather
# than user-selectable role descriptors.  The catalog is the single place that
# derives role-specific execution targets, validates verified adapters and
# applies the no-A2A-Generator policy. Reuse it here so the runtime preflight
# cannot drift from what the Console advertised and signed.
if reg.get("version") == "tool-integrations/1":
    catalog = os.path.join(dispatch_dir, "tool-catalog.py")
    try:
        result = subprocess.run(
            [sys.executable, catalog, "catalog", "--registry", p, "--adapters", adapters_dir],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
    except OSError as exc:
        print(f"[dispatch] ⛔ 无法启动 tool-catalog.py：{exc}")
        sys.exit(2)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        print(f"[dispatch] ⛔ CLI integration 注册表校验失败（{p}）：{detail[:800]}")
        sys.exit(2)
    try:
        catalog_value = json.loads(result.stdout)
        role_entries = catalog_value.get("roles") if isinstance(catalog_value, dict) else None
        target_count = sum(len(role_entries.get(role, [])) for role in ("planner", "generator", "evaluator")) if isinstance(role_entries, dict) else 0
    except (TypeError, ValueError):
        print("[dispatch] ⛔ tool-catalog.py 返回了非法 catalog")
        sys.exit(2)
    if target_count == 0:
        print("[dispatch] ⛔ CLI integration 注册表没有可执行的角色能力")
        sys.exit(2)
    print(f"[dispatch] ✓ CLI integration 注册表合法（{target_count} 个角色能力）")
    sys.exit(0)

errs = []
if reg.get("version") != "dispatch/1":
    errs.append(f"version 必须为 'dispatch/1'（当前 {reg.get('version')!r}）")
agents = reg.get("agents")
if not isinstance(agents, list) or not agents:
    errs.append("agents 必须为非空数组")
    agents = []

ROLES = {"planner", "generator", "evaluator"}
TRANSPORTS = {"subagent", "local-cli", "a2a"}
AGENT_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
seen = set()
for index, a in enumerate(agents):
    if not isinstance(a, dict):
        errs.append(f"agents[{index}] 必须为 object")
        continue
    raw_aid = a.get("id")
    aid = raw_aid if isinstance(raw_aid, str) else "<无效 id>"
    if not isinstance(raw_aid, str) or not AGENT_ID.fullmatch(raw_aid):
        errs.append(
            f"[{aid}] id 必须匹配 "
            "[A-Za-z0-9][A-Za-z0-9._-]{0,127}；它会进入受控 shell 参数和路径"
        )
    if aid in seen: errs.append(f"[{aid}] id 重复")
    seen.add(aid)
    rs = a.get("roles")
    roles = rs if isinstance(rs, list) and all(isinstance(role, str) for role in rs) else []
    if (
        not isinstance(rs, list)
        or not rs
        or any(role not in ROLES for role in roles)
        or len(roles) != len(set(roles))
    ):
        errs.append(f"[{aid}] roles 非法：{rs!r}（合法值 {sorted(ROLES)}）")
    t = a.get("transport")
    if t not in TRANSPORTS:
        errs.append(f"[{aid}] transport 非法：{t!r}")
    family = a.get("model_family")
    if not isinstance(family, str) or not family.strip():
        errs.append(f"[{aid}] model_family 必须是非空字符串 —— 独立性互斥校验依赖它，不可省")
    if t == "local-cli" and not a.get("adapter"):
        errs.append(f"[{aid}] transport=local-cli 必须声明 adapter")
    if t == "a2a" and not a.get("endpoint"):
        errs.append(f"[{aid}] transport=a2a 必须声明 endpoint")
    if t == "a2a":
        try:
            a2a_auth_config(a.get("auth", A2A_AUTH_UNSET), f"[{aid}] auth")
        except DispatchContractError as ex:
            errs.append(str(ex))
    elif "auth" in a:
        errs.append(f"[{aid}] auth 仅支持 transport=a2a，不能保留会被忽略的死配置")
    if t == "subagent" and not a.get("agent_type"):
        errs.append(f"[{aid}] transport=subagent 必须声明 agent_type")
    # A2A currently carries only the structured artifact. It has no source
    # diff / commit handoff protocol, so an A2A Generator would make an
    # implementation look executable while its source changes cannot return.
    if t == "a2a" and "generator" in roles:
        errs.append(
            f"[{aid}] transport=a2a 暂不支持 generator —— "
            "尚无 source-handoff protocol，不能把源码改动安全回流"
        )
    # A Planner subagent is proposal-only. Its singular agent_type cannot also
    # safely represent a Generator/Evaluator persona.
    if t == "subagent" and "planner" in roles:
        if a.get("agent_type") != "planner-proposal":
            errs.append(
                f"[{aid}] subagent Planner 的 agent_type 必须为 "
                "'planner-proposal'"
            )
        if set(roles) != {"planner"}:
            errs.append(
                f"[{aid}] subagent Planner 的 roles 必须恰为 ['planner']；"
                "不得与其他角色共用 persona"
            )
    try:
        effective_timeout(None, a.get("timeout_s"))
    except DispatchContractError as ex:
        errs.append(f"[{aid}] {ex}")

    c = a.get("constraints") or {}
    if not isinstance(c, dict):
        errs.append(f"[{aid}] constraints 必须为 object")
        c = {}
    # 硬约束：evaluator 恒不得改产品代码；外部实例恒不得直接 push
    if "evaluator" in roles and c.get("write_src") is True:
        errs.append(f"[{aid}] 含 evaluator 角色却 constraints.write_src=true —— 违反「Evaluator 不修改产品代码」")
    if "planner" in roles and c.get("write_src") is True:
        errs.append(f"[{aid}] 含 planner 角色却 constraints.write_src=true —— Planner 只能返回 proposal")
    if "planner" in roles and c.get("push") is True:
        errs.append(f"[{aid}] 含 planner 角色却 constraints.push=true —— Planner 不得提交或推送")
    if "generator" in roles and t == "local-cli":
        if c.get("write_src") is not True:
            errs.append(f"[{aid}] local-cli Generator 必须 constraints.write_src=true —— 否则无法返回源码 diff")
        if c.get("push") is not False:
            errs.append(f"[{aid}] local-cli Generator 必须 constraints.push=false —— 回流提交只能由 Coordinator 完成")
        if c.get("l2") is not False:
            errs.append(f"[{aid}] local-cli Generator 必须 constraints.l2=false —— 固定 handoff 契约禁止 L2")
    if t != "subagent" and c.get("push") is True:
        errs.append(f"[{aid}] 外部实例（transport={t}）不得 constraints.push=true —— 产物须由编排者校验 tag 归属后回流")
    # 硬性前置：外部 CLI 用登录 shell 执行命令，继承真实 HOME 会让 ~/.zshenv / ~/.zprofile
    # 里的 export 绕过 env 白名单还原敏感变量（实测，dispatch-mode.md §5.1 L1）
    sandbox = a.get("sandbox") or {}
    if not isinstance(sandbox, dict):
        errs.append(f"[{aid}] sandbox 必须为 object")
        sandbox = {}
    if t == "local-cli" and not sandbox.get("home_dir"):
        errs.append(f"[{aid}] transport=local-cli 必须配 sandbox.home_dir —— "
                    f"否则子进程继承真实 HOME，其 .zshenv/.zprofile 的 export 会绕过 env 白名单")
    if t == "local-cli":
        try:
            external_environment_allowlist(
                sandbox.get("env_allow"), f"[{aid}] sandbox.env_allow"
            )
            external_environment_set(
                sandbox.get("env_set"), f"[{aid}] sandbox.env_set"
            )
        except DispatchContractError as ex:
            errs.append(str(ex))

if errs:
    print(f"[dispatch] ⛔ 注册表校验失败（{p}）：")
    for e in errs: print("   -", e)
    sys.exit(2)
print(f"[dispatch] ✓ 注册表合法（{len(agents)} 个 agent）")
PY
  ;;

envelope)
  ENV_F="${2:?用法: validate-dispatch.sh envelope <envelope.json>}"
  [ -f "$ENV_F" ] || { echo "[dispatch] ⛔ 信封不存在：$ENV_F"; exit 2; }
  python3 - "$ENV_F" "$DISPATCH_DIR" <<'PY'
import json, re, sys
p, dispatch_dir = sys.argv[1:3]
sys.path.insert(0, dispatch_dir)
from dispatch_common import DispatchContractError, bounded_seconds
try: e = json.load(open(p))
except Exception as ex: print(f"[dispatch] ⛔ 信封 JSON 非法：{ex}"); sys.exit(2)
if not isinstance(e, dict):
    print(f"[dispatch] ⛔ 信封根节点必须为 object（当前 {type(e).__name__}）")
    sys.exit(2)

ALLOWED = {"task_id","contract_version","batch","role","repo","spec","features",
           "l2_authorized","contract","deliverable","deadline_s"}
REQUIRED = {"task_id","contract_version","batch","role","repo","l2_authorized","contract","deliverable"}
SAFE_TASK_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{7,127}\Z")
SAFE_BATCH = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
CANONICAL_COMMIT_SHA = re.compile(r"(?:[0-9a-f]{40}|[0-9a-f]{64})\Z")
# Repository-relative path segments only. This intentionally excludes absolute
# paths, empty segments, . / .., and backslashes before any transport can use
# the value in a worktree, state, or local artifact path.
SAFE_ARTIFACT = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)*\Z")
errs = []

# 核心安全属性：字段白名单。多出来的字段 = 夹带通道（铁律 12）
extra = set(e) - ALLOWED
if extra:
    errs.append(f"信封含白名单外字段 {sorted(extra)} —— 夹带通道，拒收（铁律 12 的结构强制）")
for k in sorted(REQUIRED - set(e)):
    errs.append(f"缺必填字段 {k}")

if e.get("contract_version") != "harness/1.1":
    errs.append(f"contract_version 必须为 'harness/1.1'（当前 {e.get('contract_version')!r}）")
role = e.get("role")
if role not in ("planner", "generator", "evaluator"):
    errs.append(f"role 非法：{e.get('role')!r}")
if not isinstance(e.get("l2_authorized"), bool):
    errs.append("l2_authorized 必须为 boolean（缺省不等于 false，必须显式）")
if len(str(e.get("contract", ""))) < 40:
    errs.append("contract 内联契约摘要过短 —— 外部 CLI 不读仓内指令文件，契约必须随信封走")
task_id = e.get("task_id")
if not isinstance(task_id, str) or not SAFE_TASK_ID.fullmatch(task_id):
    errs.append(
        "task_id 必须匹配 [A-Za-z0-9][A-Za-z0-9._-]{7,127} "
        "—— 它会进入受控 worktree 与 state 路径"
    )
batch = e.get("batch")
if not isinstance(batch, str) or not SAFE_BATCH.fullmatch(batch):
    errs.append(
        "batch 必须匹配 [A-Za-z0-9][A-Za-z0-9._-]{0,127} "
        "—— 它会进入受控 worktree、state 与 artifact 路径"
    )
if "deadline_s" in e:
    try:
        bounded_seconds(e.get("deadline_s"), "deadline_s")
    except DispatchContractError as ex:
        errs.append(str(ex))

repo_raw = e.get("repo")
repo = repo_raw if isinstance(repo_raw, dict) else {}
if not isinstance(repo_raw, dict): errs.append("repo 必须为 object")
if not repo.get("url"): errs.append("repo.url 缺失")
ref = repo.get("ref")
if not isinstance(ref, str) or not CANONICAL_COMMIT_SHA.fullmatch(ref):
    errs.append(
        "repo.ref 必须是 40 或 64 位小写十六进制 immutable commit SHA "
        "（不接受分支、tag、短 SHA 或大写）"
    )

d_raw = e.get("deliverable")
d = d_raw if isinstance(d_raw, dict) else {}
if not isinstance(d_raw, dict): errs.append("deliverable 必须为 object")
artifact = d.get("artifact")
if not isinstance(artifact, str) or not SAFE_ARTIFACT.fullmatch(artifact):
    errs.append(
        "deliverable.artifact 必须是安全仓内相对路径 "
        "（禁止绝对路径、空段、. / .. 与反斜杠）"
    )
if not d.get("schema"):   errs.append("deliverable.schema 缺失 —— 无 schema 即无机械拒收能力")

if role == "evaluator":
    expected = f"docs/test-reports/{batch}-verdict.json"
    if artifact != expected:
        errs.append(
            "evaluator deliverable.artifact 必须精确为 "
            "docs/test-reports/<batch>-verdict.json"
        )
    if d.get("schema") != ".claude/autonomous/verdict-artifact.schema.json":
        errs.append("evaluator deliverable.schema 必须为 .claude/autonomous/verdict-artifact.schema.json")
    if d.get("commit_to", object()) is not None:
        errs.append("evaluator deliverable.commit_to 必须显式为 null")
if role == "generator" and artifact != f"docs/test-reports/generator-handoff-{task_id}.json":
    errs.append(
        "generator deliverable.artifact 必须精确为 "
        "docs/test-reports/generator-handoff-<task_id>.json"
    )

# Planner 只能交结构化 proposal；Coordinator 在人类确认后才可物化它。
# 在信封层锁定路径、schema、无 L2、无 commit，避免把它误当成可直接执行的计划。
if role == "planner":
    if e.get("l2_authorized") is not False:
        errs.append("planner 信封的 l2_authorized 必须为 false")
    if artifact != f"docs/test-reports/planner-proposal-{task_id}.json":
        errs.append(
            "planner deliverable.artifact 必须为 "
            "docs/test-reports/planner-proposal-<safe-task-id>.json"
        )
    if d.get("schema") != ".claude/dispatch/planner-proposal.schema.json":
        errs.append("planner deliverable.schema 必须为 .claude/dispatch/planner-proposal.schema.json")
    if d.get("commit_to", object()) is not None:
        errs.append("planner deliverable.commit_to 必须显式为 null")

if errs:
    print(f"[dispatch] ⛔ 信封校验失败（{p}）：")
    for x in errs: print("   -", x)
    sys.exit(2)
print(f"[dispatch] ✓ 信封合法（task={e['task_id']} batch={e['batch']} role={e['role']}）")
PY
  ;;

assignments)
  PROG="${2:-progress.json}"
  REG="${3:-.agents-registry.json}"
  [ -f "$PROG" ] || { echo "[dispatch] ⛔ progress.json 不存在：$PROG"; exit 2; }
  [ -f "$REG" ]  || { echo "[dispatch] ⚠️ 无注册表，跳过 dispatch 层校验"; exit 0; }
  REQUESTED_ADAPTERS=""
  if [ "${4:-}" = "--adapters" ]; then
    [ -n "${5:-}" ] || { echo "[dispatch] ⛔ assignments --adapters 缺值"; exit 2; }
    REQUESTED_ADAPTERS="$5"
  elif [ -n "${4:-}" ]; then
    REQUESTED_ADAPTERS="$4"
  fi
  ADAPTERS="$(resolve_active_adapters "$PROG" "$REQUESTED_ADAPTERS")" || exit 2
  python3 - "$PROG" "$REG" "$DISPATCH_DIR" "$ADAPTERS" <<'PY'
import json, os, subprocess, sys
prog_p, reg_p, dispatch_dir, adapters_dir = sys.argv[1:5]
try:
    prog = json.load(open(prog_p)); reg = json.load(open(reg_p))
except Exception as e:
    print(f"[dispatch] ⛔ JSON 非法：{e}"); sys.exit(2)

ra = prog.get("role_assignments")
if not ra:
    print("[dispatch] ✓ 无 role_assignments（默认映射，快车道），跳过"); sys.exit(0)
if not isinstance(ra, dict):
    print("[dispatch] ⛔ role_assignments 必须为 object 或 null"); sys.exit(2)

allowed_roles = {"planner", "generator", "evaluator"}
errs = []
if unknown := sorted(set(ra) - allowed_roles):
    errs.append(f"role_assignments 含未知角色：{unknown}")

by_id = {}
if reg.get("version") == "tool-integrations/1":
    catalog = os.path.join(dispatch_dir, "tool-catalog.py")
    for role, aid in ra.items():
        if role not in allowed_roles:
            continue
        if aid is None:
            if role != "planner":
                errs.append(f"role_assignments.{role} 不得为 null")
            continue
        if not isinstance(aid, str):
            errs.append(f"role_assignments.{role} 必须是稳定目标 id 或 null")
            continue
        try:
            result = subprocess.run(
                [sys.executable, catalog, "target", "--registry", reg_p,
                 "--adapters", adapters_dir, "--target-id", aid],
                text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                check=False, timeout=15,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            errs.append(f"role_assignments.{role} 无法解析目标 {aid!r}：{exc}")
            continue
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "tool catalog failed").strip()
            errs.append(f"role_assignments.{role}={aid!r} 不是可执行 canonical 目标：{detail[:400]}")
            continue
        try:
            target = json.loads(result.stdout)
        except (TypeError, ValueError) as exc:
            errs.append(f"role_assignments.{role}={aid!r} 的 catalog 输出非法：{exc}")
            continue
        if not isinstance(target, dict) or target.get("target_id") != aid:
            errs.append(f"role_assignments.{role}={aid!r} 的 catalog 目标不一致")
            continue
        if role not in target.get("roles", []):
            errs.append(f"{aid} 的 roles={target.get('roles')!r} 不含 {role} —— 越权分配")
            continue
        family = target.get("model_family")
        if not isinstance(family, str) or not family:
            errs.append(f"{aid} 的 model_family 非法")
            continue
        by_id[aid] = target
elif reg.get("version") == "dispatch/1":
    by_id = {a.get("id"): a for a in reg.get("agents", []) if isinstance(a, dict)}
    for role, aid in ra.items():
        if role not in allowed_roles:
            continue
        if aid is None:
            if role != "planner":
                errs.append(f"role_assignments.{role} 不得为 null")
            continue
        d = by_id.get(aid)
        if d is None:
            errs.append(f"role_assignments.{role}={aid!r} 在注册表中不存在 —— 编排者无法解析派活方式")
            continue
        if role not in (d.get("roles") or []):
            errs.append(f"{aid} 的 roles={d.get('roles')} 不含 {role} —— 越权分配")
else:
    errs.append(f"不支持的 registry version：{reg.get('version')!r}")

g, ev = ra.get("generator"), ra.get("evaluator")
if g and ev:
    if g == ev:
        errs.append(f"generator 与 evaluator 同为 {g} —— 自评，违反铁律 4")
    else:
        dg, de = by_id.get(g), by_id.get(ev)
        if dg and de:
            fg, fe = dg.get("model_family"), de.get("model_family")
            # v1.1 放开外部 generator 后新增的洞：两个不同进程、fresh context，
            # 完全满足铁律 4 字面要求，但同一模型实现完自己验收 —— 独立性形同虚设。
            if fg and fe and fg == fe:
                errs.append(
                    f"generator({g}) 与 evaluator({ev}) 的 model_family 同为 {fg!r} —— "
                    f"同模型自评，独立性形同虚设（dispatch-mode.md §3.2）")

if errs:
    print(f"[dispatch] ⛔ 角色分配校验失败：")
    for e in errs: print("   -", e)
    sys.exit(2)
fam = lambda x: (by_id.get(x) or {}).get("model_family", "?")
print(f"[dispatch] ✓ 角色分配合法"
      + (f"（generator={fam(g)} × evaluator={fam(ev)}，family 互斥成立）" if g and ev else ""))
PY
  ;;

receipt)
  shift
  META="${1:?用法: validate-dispatch.sh receipt <run-meta.json> [--expected-envelope <f> --active-role-json <json> --active-target-json <json> --project-root <dir>]}"
  shift
  EXPECTED_ENVELOPE=""
  ACTIVE_ROLE_JSON=""
  ACTIVE_TARGET_JSON=""
  PROJECT_ROOT=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --expected-envelope)
        [ "$#" -ge 2 ] || { echo "[dispatch] ⛔ receipt --expected-envelope 缺值" >&2; exit 2; }
        EXPECTED_ENVELOPE="$2"
        shift 2
        ;;
      --active-role-json)
        [ "$#" -ge 2 ] || { echo "[dispatch] ⛔ receipt --active-role-json 缺值" >&2; exit 2; }
        ACTIVE_ROLE_JSON="$2"
        shift 2
        ;;
      --active-target-json)
        [ "$#" -ge 2 ] || { echo "[dispatch] ⛔ receipt --active-target-json 缺值" >&2; exit 2; }
        ACTIVE_TARGET_JSON="$2"
        shift 2
        ;;
      --project-root)
        [ "$#" -ge 2 ] || { echo "[dispatch] ⛔ receipt --project-root 缺值" >&2; exit 2; }
        PROJECT_ROOT="$2"
        shift 2
        ;;
      *)
        echo "[dispatch] ⛔ receipt 未知参数：$1" >&2
        exit 2
        ;;
    esac
  done
  [ -f "$META" ] || { echo "[dispatch] ⛔ run-meta 不存在：$META"; exit 2; }
  set +e
  RC_JSON=$(python3 - "$META" <<'PY'
import json, sys, os
p = sys.argv[1]
try: m = json.load(open(p))
except Exception as e:
    # Keep the receipt shape useful to the dispatcher even when the metadata is
    # corrupt. It can report the durable run-meta pointer without inventing any
    # artifact or envelope location.
    print(json.dumps({
        "state": "FAILED",
        "reason": f"run-meta 非法：{e}",
        "artifact": None,
        "artifact_path": "",
        "run_meta_path": os.path.abspath(p),
        "envelope_path": "",
        "worktree_path": None,
    }, ensure_ascii=False)); sys.exit(0)

out, art = m.get("outcome"), m.get("artifact")
def emit(state, reason, **kw):
    artifact_path = art if isinstance(art, str) else ""
    worktree = m.get("worktree")
    envelope = m.get("envelope_path")
    print(json.dumps({
        "state": state,
        "reason": reason,
        "task_id": m.get("task_id"),
        "agent_id": m.get("agent_id"),
        "model_family": m.get("model_family"),
        # artifact remains for existing callers. The *_path fields are the
        # transport-owned pointers a dispatcher may return without inference.
        "artifact": art,
        "artifact_path": artifact_path,
        "run_meta_path": os.path.abspath(p),
        "envelope_path": os.path.abspath(envelope) if isinstance(envelope, str) and envelope else "",
        "worktree_path": worktree if isinstance(worktree, str) and worktree else None,
        **kw,
    }, ensure_ascii=False)); sys.exit(0)

if out == "TIMEOUT":         emit("CANCELED", f"wall-clock 超时（{m.get('duration_s')}s）—— 凭 task_id 幂等重派")
if out == "CANCELED":        emit("CANCELED", f"外部取消（{m.get('termination_reason') or 'cancel'}）—— 不伪装成 timeout")
if out == "FAILED":          emit("FAILED", f"子进程非零退出（exit={m.get('exit_code')}）")
# ⚠️ 关键：退出码 0 不等于活干完了。外部 CLI「礼貌地失败」是常态，
#    不写死这条，礼貌失败会被当成验收通过。
if out == "ARTIFACT_MISSING":emit("FAILED", "退出码 0 但产物缺失 —— exit 0 ≠ 完成，判 FAILED")

try: a = json.load(open(art))
except Exception as e:       emit("ARTIFACT_INVALID", f"产物 JSON 非法：{e}")

w = a.get("waiting")
if w == "auth":         emit("AUTH_REQUIRED", a.get("waiting_detail") or "撞 L2 边界，等用户授权")
if w == "adjudication": emit("INPUT_REQUIRED", a.get("waiting_detail") or "规格歧义，等 Planner/用户裁决")
if w == "input":
    if m.get("role") == "planner":
        emit("INPUT_REQUIRED", a.get("waiting_detail") or "Planner proposal 需要用户澄清")
    emit("ARTIFACT_INVALID", "waiting='input' 只允许 Planner proposal 使用")
if w not in (None, ""): emit("ARTIFACT_INVALID", f"waiting 取值非法：{w!r}")
emit("COMPLETED", "产物已返回，待 schema 内容校验")
PY
)
  set -e
  STATE=$(printf '%s' "$RC_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['state'])")
  ART=$(printf '%s' "$RC_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('artifact') or '')")
  ROLE=$(python3 - "$META" <<'PY'
import json, sys
try: print(json.load(open(sys.argv[1])).get("role") or "")
except Exception: print("")
PY
)
  TRANSPORT=$(python3 - "$META" <<'PY'
import json, sys
try: print(json.load(open(sys.argv[1])).get("transport") or "")
except Exception: print("")
PY
)
  SCHEMA=$(python3 - "$META" <<'PY'
import json, sys
try: print((json.load(open(sys.argv[1])).get("deliverable") or {}).get("schema") or "")
except Exception: print("")
PY
)
  DELIVERABLE_ARTIFACT=$(python3 - "$META" <<'PY'
import json, sys
try:
    value = (json.load(open(sys.argv[1])).get("deliverable") or {}).get("artifact")
    print(value if isinstance(value, str) else "")
except Exception:
    print("")
PY
)
  TASK_ID=$(python3 - "$META" <<'PY'
import json, sys
try: print(json.load(open(sys.argv[1])).get("task_id") or "")
except Exception: print("")
PY
)
  BATCH=$(python3 - "$META" <<'PY'
import json, sys
try: print(json.load(open(sys.argv[1])).get("batch") or "")
except Exception: print("")
PY
)
  REF=$(python3 - "$META" <<'PY'
import json, sys
try: print(json.load(open(sys.argv[1])).get("ref") or "")
except Exception: print("")
PY
)
  ENVELOPE_PATH=$(python3 - "$META" <<'PY'
import json, sys
try:
    value = json.load(open(sys.argv[1])).get("envelope_path")
    print(value if isinstance(value, str) else "")
except Exception:
    print("")
PY
)
  invalidate_receipt() {
    RC_JSON="$(python3 - "$RC_JSON" "$1" <<'PY'
import json
import sys

receipt = json.loads(sys.argv[1])
receipt["state"] = "ARTIFACT_INVALID"
receipt["reason"] = sys.argv[2]
print(json.dumps(receipt, ensure_ascii=False))
PY
)"
    STATE="ARTIFACT_INVALID"
  }
  # A caller that supplies the commissioned envelope must not let untrusted
  # run-meta select the role-specific validation path. This is mandatory for
  # every active external route: otherwise a forged role could skip both its
  # artifact contract and the provider-owned receipt check.
  EXPECTED_ROLE=""
  if [ -n "$EXPECTED_ENVELOPE" ]; then
    if ! EXPECTED_ROLE="$(python3 - "$EXPECTED_ENVELOPE" <<'PY'
import json
import sys

try:
    envelope = json.load(open(sys.argv[1], encoding="utf-8"))
except (OSError, ValueError):
    raise SystemExit(2)
role = envelope.get("role") if isinstance(envelope, dict) else None
if role not in {"planner", "generator", "evaluator"}:
    raise SystemExit(2)
print(role)
PY
)"; then
      invalidate_receipt "expected envelope has no valid dispatch role"
    fi
  fi
  EFFECTIVE_ROLE="$ROLE"
  if [ -n "$EXPECTED_ROLE" ]; then
    if [ "$ROLE" != "$EXPECTED_ROLE" ]; then
      invalidate_receipt "run metadata role does not match the commissioned envelope role"
    else
      EFFECTIVE_ROLE="$EXPECTED_ROLE"
    fi
  fi
  ACTIVE_RETURN_ROUTE="legacy"
  if { [ -n "$ACTIVE_ROLE_JSON" ] && [ "$ACTIVE_ROLE_JSON" != "{}" ]; } || \
     { [ -n "$ACTIVE_TARGET_JSON" ] && [ "$ACTIVE_TARGET_JSON" != "{}" ]; }; then
    if [ ! -f "$ACTIVE_RETURN_ROUTE_VALIDATOR" ]; then
      invalidate_receipt "active return route validator is unavailable"
    elif ! ACTIVE_RETURN_ROUTE_JSON="$(python3 "$ACTIVE_RETURN_ROUTE_VALIDATOR" \
      --run-meta "$META" --active-role-json "$ACTIVE_ROLE_JSON" \
      --active-target-json "$ACTIVE_TARGET_JSON")"; then
      invalidate_receipt "run metadata transport does not match the re-verified active target"
    else
      ACTIVE_RETURN_ROUTE="$(printf '%s' "$ACTIVE_RETURN_ROUTE_JSON" | python3 -c \
        "import json,sys; print(json.load(sys.stdin).get('route') or '')")"
      case "$ACTIVE_RETURN_ROUTE" in
        local-cli|a2a|host-native-subagent|external-bridge-subagent) ;;
        *) invalidate_receipt "active return route validator returned an invalid route" ;;
      esac
    fi
  fi
  if [ "$ACTIVE_RETURN_ROUTE" = "external-bridge-subagent" ] && [ -z "$EXPECTED_ROLE" ]; then
    invalidate_receipt "external bridge receipt lacks a commissioned envelope role"
  fi
  # Planner artifacts have a different semantic schema from verdicts. Validate
  # both a completed proposal and a request-for-input before returning the
  # receipt state to the Coordinator.
  if [ "$EFFECTIVE_ROLE" = "planner" ] && { [ "$STATE" = "COMPLETED" ] || [ "$STATE" = "INPUT_REQUIRED" ]; }; then
    if [ "$SCHEMA" != ".claude/dispatch/planner-proposal.schema.json" ]; then
      echo "[dispatch] ⛔ Planner deliverable schema 非法" >&2
      invalidate_receipt "planner deliverable schema is not allowed"
    elif ! "$DISPATCH_DIR/validate-planner-proposal.sh" "$ART" "$TASK_ID" "$BATCH" "$REF" >&2; then
      invalidate_receipt "planner proposal failed schema validation"
    fi
  fi
  # Generator handoffs must be bound to the exact commissioned envelope, not
  # merely to an artifact filename. envelope_path is emitted by every trusted
  # transport run-meta writer before this receipt is evaluated.
  if [ "$EFFECTIVE_ROLE" = "generator" ] && {
    [ "$STATE" = "COMPLETED" ] || [ "$STATE" = "AUTH_REQUIRED" ] || [ "$STATE" = "INPUT_REQUIRED" ];
  }; then
    if [ "$SCHEMA" != ".claude/dispatch/generator-handoff.schema.json" ]; then
      echo "[dispatch] ⛔ Generator deliverable schema 非法" >&2
      invalidate_receipt "generator deliverable schema is not allowed"
    elif [ -z "$ENVELOPE_PATH" ] || [ ! -f "$ENVELOPE_PATH" ]; then
      echo "[dispatch] ⛔ Generator run-meta 缺有效 envelope_path" >&2
      invalidate_receipt "generator run-meta lacks a readable envelope_path"
    elif ! "$DISPATCH_DIR/validate-generator-handoff.sh" "$ART" --envelope "$ENVELOPE_PATH" >&2; then
      invalidate_receipt "generator handoff failed schema and envelope validation"
    fi
  fi
  # The signed active target, never the untrusted return metadata, decides
  # whether provider receipt validation is mandatory. Legacy host-native
  # subagents remain supported only when they do not claim a provider bridge.
  if [ "$ACTIVE_RETURN_ROUTE" = "external-bridge-subagent" ] && {
    [ "$STATE" = "COMPLETED" ] || [ "$STATE" = "AUTH_REQUIRED" ] || [ "$STATE" = "INPUT_REQUIRED" ];
  } && { [ "$EFFECTIVE_ROLE" = "planner" ] || [ "$EFFECTIVE_ROLE" = "generator" ] || [ "$EFFECTIVE_ROLE" = "evaluator" ]; }; then
    if [ -z "$EXPECTED_ENVELOPE" ] || [ -z "$ACTIVE_ROLE_JSON" ] || [ -z "$ACTIVE_TARGET_JSON" ] || [ -z "$PROJECT_ROOT" ]; then
      echo "[dispatch] ⛔ external $EFFECTIVE_ROLE receipt 缺少 envelope、active role、active target 或 project root 上下文" >&2
      invalidate_receipt "external $EFFECTIVE_ROLE receipt lacks signed validation context"
    elif [ ! -f "$EXTERNAL_RECEIPT_VALIDATOR" ]; then
      echo "[dispatch] ⛔ external bridge receipt validator 不存在" >&2
      invalidate_receipt "external $EFFECTIVE_ROLE receipt validator is unavailable"
    elif ! python3 "$EXTERNAL_RECEIPT_VALIDATOR" \
      --role "$EFFECTIVE_ROLE" --run-meta "$META" --artifact "$ART" \
      --envelope "$EXPECTED_ENVELOPE" --project-root "$PROJECT_ROOT" \
      --active-role-json "$ACTIVE_ROLE_JSON" --active-target-json "$ACTIVE_TARGET_JSON" >&2; then
      invalidate_receipt "provider-attested external $ROLE receipt validation failed"
    fi
  elif [ "$TRANSPORT" = "subagent" ] && {
    [ "$STATE" = "COMPLETED" ] || [ "$STATE" = "AUTH_REQUIRED" ] || [ "$STATE" = "INPUT_REQUIRED" ];
  } && { [ "$EFFECTIVE_ROLE" = "planner" ] || [ "$EFFECTIVE_ROLE" = "generator" ] || [ "$EFFECTIVE_ROLE" = "evaluator" ]; }; then
    if python3 - "$META" <<'PY'
import json
import sys

try:
    meta = json.load(open(sys.argv[1], encoding="utf-8"))
except (OSError, ValueError):
    raise SystemExit(2)
raise SystemExit(0 if meta.get("bridge") is None else 1)
PY
    then
      :
    else
      invalidate_receipt "subagent provider bridge receipt lacks an external active target"
    fi
  fi
  if [ "$EFFECTIVE_ROLE" = "evaluator" ] && [ "$STATE" = "COMPLETED" ]; then
    VVA="$DISPATCH_DIR/../autonomous/validate-verdict-artifact.sh"
    EXPECTED_EVALUATOR_ARTIFACT="docs/test-reports/${BATCH}-verdict.json"
    if [ "$DELIVERABLE_ARTIFACT" != "$EXPECTED_EVALUATOR_ARTIFACT" ]; then
      echo "[dispatch] ⛔ Evaluator deliverable artifact 非法" >&2
      invalidate_receipt "evaluator deliverable artifact is not the fixed batch verdict path"
    elif [ "$SCHEMA" != ".claude/autonomous/verdict-artifact.schema.json" ]; then
      echo "[dispatch] ⛔ Evaluator deliverable schema 非法" >&2
      invalidate_receipt "evaluator deliverable schema is not allowed"
    elif [ -n "$ART" ] && [ -x "$VVA" ]; then
      if ! "$VVA" "$ART" >&2; then
        echo "[dispatch] ⛔ 产物未过 verdict schema → ARTIFACT_INVALID" >&2
        invalidate_receipt "verdict artifact failed schema validation"
      fi
    fi
  fi
  echo "$RC_JSON"
  case "$STATE" in
    COMPLETED)
      echo "[dispatch] ✓ 回执 COMPLETED" >&2; exit 0 ;;
    AUTH_REQUIRED|INPUT_REQUIRED)
      echo "[dispatch] ⏸ 回执 $STATE —— 硬停交人类，不得自行推进" >&2; exit 3 ;;
    *)
      echo "[dispatch] ⛔ 回执 $STATE —— 重派上限 1 次，仍失败则硬停" >&2; exit 4 ;;
  esac
  ;;

all)
  "$0" registry || exit 2
  "$0" assignments || exit 2
  ;;

*)
  echo "用法: validate-dispatch.sh {registry|envelope|assignments|receipt|hook|all} [args]" >&2
  exit 2 ;;
esac
