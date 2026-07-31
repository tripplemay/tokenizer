#!/usr/bin/env bash
# dispatch-mode.md 统一派活入口 —— 按 descriptor.transport 路由，对上层隐藏 transport 差异。
#
#   local-cli → sandbox-profile.sh（本机 fork 子进程，阻塞）
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
[ -f "$REGISTRY" ] || die "注册表不存在：${REGISTRY}"

# 信封白名单校验前置到这里，两条 transport 共用（铁律 12 的机械强制）
bash "$DISPATCH_DIR/validate-dispatch.sh" envelope "$ENVELOPE" >&2 || die "信封校验未过，不派活"
# The registry is part of the execution contract too. In particular, it
# rejects a2a+generator before a transport can claim source changes are
# returnable without a source-handoff protocol.
bash "$DISPATCH_DIR/validate-dispatch.sh" registry "$REGISTRY" >&2 || die "注册表校验未过，不派活"
# 本地 repo.url 必须与调用入口所在 git 仓一致。此检查发生在任何 state/workroot 目录创建之前。
PROJECT_ROOT="$(python3 "$DISPATCH_DIR/dispatch_common.py" repo-preflight \
  --envelope "$ENVELOPE" --cwd "$PWD")" || die "repo.url 前置校验未过，不派活"

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
if [ -n "$ACTIVE_PROGRESS" ]; then
  ACTIVE_ARGS=(--role "$ROLE" --expected-agent "$AGENT_ID" --progress "$ACTIVE_PROGRESS" --registry "$REGISTRY")
  [ -z "$ADAPTERS" ] || ACTIVE_ARGS+=(--adapters "$ADAPTERS")
  [ -z "$PUB" ] || ACTIVE_ARGS+=(--pub "$PUB")
  bash "$DISPATCH_DIR/resolve-active-mode-role.sh" "${ACTIVE_ARGS[@]}" >/dev/null \
    || die "active mode role 复验失败；拒绝使用未验证的 --agent"
fi

if ! TRANSPORT="$(python3 - "$REGISTRY" "$AGENT_ID" "$ENVELOPE" <<'PY'
import json
import sys

registry_path, agent_id, envelope_path = sys.argv[1:4]
try:
    registry = json.load(open(registry_path, encoding="utf-8"))
    envelope = json.load(open(envelope_path, encoding="utf-8"))
except Exception as exc:
    print(f"[dispatch-run] ⛔ descriptor preflight failed: {exc}", file=sys.stderr)
    raise SystemExit(2)

descriptor = next(
    (item for item in registry.get("agents", []) if item.get("id") == agent_id), None
)
if descriptor is None:
    print(f"[dispatch-run] ⛔ 注册表中无此 agent：{agent_id}", file=sys.stderr)
    raise SystemExit(2)
role = envelope.get("role")
if role not in (descriptor.get("roles") or []):
    print(
        f"[dispatch-run] ⛔ {agent_id} 的 roles={descriptor.get('roles')} 不含信封 role={role!r}",
        file=sys.stderr,
    )
    raise SystemExit(2)
if role == "generator" and descriptor.get("transport") == "a2a":
    print(
        "[dispatch-run] ⛔ a2a transport 暂不支持 generator："
        "尚无 source-handoff protocol，不能安全回流源码改动",
        file=sys.stderr,
    )
    raise SystemExit(2)
print(descriptor.get("transport") or "")
PY
)"; then
  die "agent descriptor 与信封角色不兼容"
fi

case "$TRANSPORT" in
  local-cli)
    echo "[dispatch-run] transport=local-cli → 本机沙箱" >&2
    LOCAL_ARGS=(
      --agent "$AGENT_ID" --envelope "$ENVELOPE"
      --registry "$REGISTRY" --workroot "$WORKROOT" --state "$STATE"
    )
    [ -z "$ADAPTERS" ] || LOCAL_ARGS+=(--adapters "$ADAPTERS")
    if [ "${#EXTRA[@]}" -gt 0 ]; then
      LOCAL_ARGS+=("${EXTRA[@]}")
    fi
    exec bash "$DISPATCH_DIR/sandbox-profile.sh" "${LOCAL_ARGS[@]}"
    ;;
  a2a)
    echo "[dispatch-run] transport=a2a → 远端 runner（SSE 订阅至终态）" >&2
    exec python3 "$DISPATCH_DIR/transports/a2a-client.py" run \
      --agent "$AGENT_ID" --envelope "$ENVELOPE" \
      --registry "$REGISTRY" --state "$STATE" --project-root "$PROJECT_ROOT" ${EXTRA[@]+"${EXTRA[@]}"}
    ;;
  subagent)
    die "$AGENT_ID 的 transport=subagent —— 同会话 subagent 由编排者直接派，不走本入口"
    ;;
  "")
    die "注册表中无此 agent 或未声明 transport：$AGENT_ID"
    ;;
  *)
    die "未知 transport：$TRANSPORT"
    ;;
esac
