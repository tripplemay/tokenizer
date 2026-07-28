#!/usr/bin/env bash
# dispatch-mode.md 的 fail-closed 校验器。四种用途，一个入口：
#
#   validate-dispatch.sh registry    [.agents-registry.json]        L1 descriptor 合法性
#   validate-dispatch.sh envelope    <envelope.json>                L2 信封（字段白名单 = 铁律 12 强制）
#   validate-dispatch.sh assignments [progress.json] [registry]     ⚠️ 独立性互斥：generator/evaluator 的 model_family 必须不同
#   validate-dispatch.sh receipt     <run-meta.json>                L3 回执推断（exit code + 产物 + waiting → 状态）
#   validate-dispatch.sh hook                                       PostToolUse：stdin 取 file_path，命中即校验
#
# 退出码：0 通过 / 2 校验失败（fail-closed）
#         receipt 模式另有：3 = 需人类（AUTH_REQUIRED / INPUT_REQUIRED）· 4 = 可重派（FAILED / CANCELED / ARTIFACT_INVALID）
#
# 不依赖 jsonschema 库（与 validate-verdict-artifact.sh 一致，手写校验保证零依赖可跑）。

set -euo pipefail
MODE="${1:-all}"
DISPATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── PostToolUse hook：从 stdin 的 tool_input 取 file_path，命中相关文件才校验 ──
if [ "$MODE" = "hook" ]; then
  INPUT=$(cat)
  FP=$(printf '%s' "$INPUT" | python3 -c "
import json,sys
try: print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))
except Exception: pass
")
  case "$(basename "$FP" 2>/dev/null)" in
    .agents-registry.json) exec "$0" registry "$FP" ;;
    progress.json)         [ -f .agents-registry.json ] && exec "$0" assignments "$FP" || exit 0 ;;
    *) exit 0 ;;
  esac
fi

case "$MODE" in

registry)
  REG="${2:-.agents-registry.json}"
  [ -f "$REG" ] || { echo "[dispatch] ⛔ 注册表不存在：$REG"; exit 2; }
  python3 - "$REG" "$DISPATCH_DIR" <<'PY'
import json, sys
p, dispatch_dir = sys.argv[1:3]
sys.path.insert(0, dispatch_dir)
from dispatch_common import DispatchContractError, effective_timeout
try: reg = json.load(open(p))
except Exception as e: print(f"[dispatch] ⛔ 注册表 JSON 非法：{e}"); sys.exit(2)

errs = []
if reg.get("version") != "dispatch/1":
    errs.append(f"version 必须为 'dispatch/1'（当前 {reg.get('version')!r}）")
agents = reg.get("agents")
if not isinstance(agents, list) or not agents:
    errs.append("agents 必须为非空数组")
    agents = []

ROLES = {"planner", "generator", "evaluator"}
TRANSPORTS = {"subagent", "local-cli", "a2a"}
seen = set()
for a in agents:
    aid = a.get("id", "<无 id>")
    if not a.get("id"): errs.append("存在缺 id 的条目")
    if aid in seen: errs.append(f"[{aid}] id 重复")
    seen.add(aid)
    rs = a.get("roles")
    if not isinstance(rs, list) or not rs or not set(rs) <= ROLES:
        errs.append(f"[{aid}] roles 非法：{rs!r}（合法值 {sorted(ROLES)}）")
    t = a.get("transport")
    if t not in TRANSPORTS:
        errs.append(f"[{aid}] transport 非法：{t!r}")
    if not a.get("model_family"):
        errs.append(f"[{aid}] 缺 model_family —— 独立性互斥校验依赖它，不可省")
    if t == "local-cli" and not a.get("adapter"):
        errs.append(f"[{aid}] transport=local-cli 必须声明 adapter")
    if t == "a2a" and not a.get("endpoint"):
        errs.append(f"[{aid}] transport=a2a 必须声明 endpoint")
    if t == "subagent" and not a.get("agent_type"):
        errs.append(f"[{aid}] transport=subagent 必须声明 agent_type")
    try:
        effective_timeout(None, a.get("timeout_s"))
    except DispatchContractError as ex:
        errs.append(f"[{aid}] {ex}")

    c = a.get("constraints") or {}
    # 硬约束：evaluator 恒不得改产品代码；外部实例恒不得直接 push
    if "evaluator" in (rs or []) and c.get("write_src") is True:
        errs.append(f"[{aid}] 含 evaluator 角色却 constraints.write_src=true —— 违反「Evaluator 不修改产品代码」")
    if t != "subagent" and c.get("push") is True:
        errs.append(f"[{aid}] 外部实例（transport={t}）不得 constraints.push=true —— 产物须由编排者校验 tag 归属后回流")
    # 硬性前置：外部 CLI 用登录 shell 执行命令，继承真实 HOME 会让 ~/.zshenv / ~/.zprofile
    # 里的 export 绕过 env 白名单还原敏感变量（实测，dispatch-mode.md §5.1 L1）
    if t == "local-cli" and not (a.get("sandbox") or {}).get("home_dir"):
        errs.append(f"[{aid}] transport=local-cli 必须配 sandbox.home_dir —— "
                    f"否则子进程继承真实 HOME，其 .zshenv/.zprofile 的 export 会绕过 env 白名单")

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
import json, sys
p, dispatch_dir = sys.argv[1:3]
sys.path.insert(0, dispatch_dir)
from dispatch_common import DispatchContractError, bounded_seconds
try: e = json.load(open(p))
except Exception as ex: print(f"[dispatch] ⛔ 信封 JSON 非法：{ex}"); sys.exit(2)

ALLOWED = {"task_id","contract_version","batch","role","repo","spec","features",
           "l2_authorized","contract","deliverable","deadline_s"}
REQUIRED = {"task_id","contract_version","batch","role","repo","l2_authorized","contract","deliverable"}
errs = []

# 核心安全属性：字段白名单。多出来的字段 = 夹带通道（铁律 12）
extra = set(e) - ALLOWED
if extra:
    errs.append(f"信封含白名单外字段 {sorted(extra)} —— 夹带通道，拒收（铁律 12 的结构强制）")
for k in sorted(REQUIRED - set(e)):
    errs.append(f"缺必填字段 {k}")

if e.get("contract_version") != "harness/1.1":
    errs.append(f"contract_version 必须为 'harness/1.1'（当前 {e.get('contract_version')!r}）")
if e.get("role") not in ("generator", "evaluator"):
    errs.append(f"role 非法：{e.get('role')!r}")
if not isinstance(e.get("l2_authorized"), bool):
    errs.append("l2_authorized 必须为 boolean（缺省不等于 false，必须显式）")
if len(str(e.get("contract", ""))) < 40:
    errs.append("contract 内联契约摘要过短 —— 外部 CLI 不读仓内指令文件，契约必须随信封走")
if len(str(e.get("task_id", ""))) < 8:
    errs.append("task_id 过短 —— 幂等键须足够唯一")
if "deadline_s" in e:
    try:
        bounded_seconds(e.get("deadline_s"), "deadline_s")
    except DispatchContractError as ex:
        errs.append(str(ex))

repo = e.get("repo") or {}
if not repo.get("url"): errs.append("repo.url 缺失")
if len(str(repo.get("ref", ""))) < 7:
    errs.append("repo.ref 必须锁定到 commit sha（不接受分支名——验收对象须是确定快照）")

d = e.get("deliverable") or {}
if not d.get("artifact"): errs.append("deliverable.artifact 缺失")
if not d.get("schema"):   errs.append("deliverable.schema 缺失 —— 无 schema 即无机械拒收能力")

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
  python3 - "$PROG" "$REG" <<'PY'
import json, sys
prog_p, reg_p = sys.argv[1:3]
try:
    prog = json.load(open(prog_p)); reg = json.load(open(reg_p))
except Exception as e:
    print(f"[dispatch] ⛔ JSON 非法：{e}"); sys.exit(2)

ra = prog.get("role_assignments")
if not ra:
    print("[dispatch] ✓ 无 role_assignments（默认映射，快车道），跳过"); sys.exit(0)

by_id = {a.get("id"): a for a in reg.get("agents", [])}
errs = []
for role, aid in ra.items():
    if aid is None: continue
    d = by_id.get(aid)
    if d is None:
        errs.append(f"role_assignments.{role}={aid!r} 在注册表中不存在 —— 编排者无法解析派活方式")
        continue
    if role not in (d.get("roles") or []):
        errs.append(f"{aid} 的 roles={d.get('roles')} 不含 {role} —— 越权分配")

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
  META="${2:?用法: validate-dispatch.sh receipt <run-meta.json>}"
  [ -f "$META" ] || { echo "[dispatch] ⛔ run-meta 不存在：$META"; exit 2; }
  set +e
  RC_JSON=$(python3 - "$META" <<'PY'
import json, sys, os
p = sys.argv[1]
try: m = json.load(open(p))
except Exception as e:
    print(json.dumps({"state":"FAILED","reason":f"run-meta 非法：{e}"}, ensure_ascii=False)); sys.exit(0)

out, art = m.get("outcome"), m.get("artifact")
def emit(state, reason, **kw):
    print(json.dumps({"state":state,"reason":reason,"task_id":m.get("task_id"),
                      "agent_id":m.get("agent_id"),"model_family":m.get("model_family"),
                      "artifact":art, **kw}, ensure_ascii=False)); sys.exit(0)

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
if w not in (None, ""): emit("ARTIFACT_INVALID", f"waiting 取值非法：{w!r}")
emit("COMPLETED", "产物已返回，待 schema 内容校验")
PY
)
  set -e
  echo "$RC_JSON"
  STATE=$(printf '%s' "$RC_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['state'])")
  case "$STATE" in
    COMPLETED)
      ART=$(printf '%s' "$RC_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('artifact') or '')")
      VVA="$DISPATCH_DIR/../autonomous/validate-verdict-artifact.sh"
      # verdict 类产物再过机件 #3 的内容门（证据非空，拒收空壳）
      if [ -n "$ART" ] && [ -x "$VVA" ] && case "$ART" in *-verdict.json) true ;; *) false ;; esac; then
        "$VVA" "$ART" >&2 || { echo "[dispatch] ⛔ 产物未过 verdict schema → ARTIFACT_INVALID"; exit 4; }
      fi
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
