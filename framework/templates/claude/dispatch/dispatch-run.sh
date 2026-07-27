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
AGENT_ID=""; ENVELOPE=""; EXTRA=()

while [ $# -gt 0 ]; do
  case "$1" in
    --agent)    AGENT_ID="$2"; shift 2 ;;
    --envelope) ENVELOPE="$2"; shift 2 ;;
    --registry) REGISTRY="$2"; shift 2 ;;
    --workroot) WORKROOT="$2"; shift 2 ;;
    --state)    STATE="$2"; shift 2 ;;
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

TRANSPORT="$(python3 -c "
import json,sys
reg=json.load(open(sys.argv[1]))
d=next((a for a in reg.get('agents',[]) if a.get('id')==sys.argv[2]), None)
print((d or {}).get('transport',''))" "$REGISTRY" "$AGENT_ID")"

case "$TRANSPORT" in
  local-cli)
    echo "[dispatch-run] transport=local-cli → 本机沙箱" >&2
    exec bash "$DISPATCH_DIR/sandbox-profile.sh" \
      --agent "$AGENT_ID" --envelope "$ENVELOPE" \
      --registry "$REGISTRY" --workroot "$WORKROOT" --state "$STATE" \
      ${EXTRA[@]+"${EXTRA[@]}"}
    ;;
  a2a)
    echo "[dispatch-run] transport=a2a → 远端 runner（SSE 订阅至终态）" >&2
    exec python3 "$DISPATCH_DIR/transports/a2a-client.py" run \
      --agent "$AGENT_ID" --envelope "$ENVELOPE" \
      --registry "$REGISTRY" --state "$STATE" ${EXTRA[@]+"${EXTRA[@]}"}
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
