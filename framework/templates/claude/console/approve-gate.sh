#!/usr/bin/env bash
# console-mode.md —— 人类批准闸门的**本机入口**。
#
# ⚠️ **必须由你本人运行**，不要让 agent 代跑。在 Claude Code 里用 `!` 前缀自己执行：
#     ! bash .claude/console/approve-gate.sh --approve --by yixing
#
# 为什么必须你自己跑：`pending_gate.decision` 是「人类批准」在 git 里的唯一表示。
# agent 若能写它，「阶段推进键归人」「L2 需授权」就全部退化成自觉。
#
# ── 本机批准不依赖控制台 ──
# 控制台不是批准权的来源，只是**同一把私钥的另一个持有者**。本脚本在两种模式下都自足：
#   · 未配 console.pub → 写明文 decision + 立即 commit（guard 走「比对 HEAD」）
#   · 已配 console.pub → 本脚本**自己签名**（用你手上的私钥），guard 走验签
# 控制台挂了、网络断了、密钥没上云，本机批准照常可用；开发也从不需要控制台在线。
#
# ── 私钥来源（验签模式下必需，按序探测）──
#   ① --key <路径>              也支持 keychain:<服务名>（macOS 钥匙串；见文末「加固」）
#   ② $HARNESS_CONSOLE_KEY      私钥路径
#   ③ ~/.harness-console/console.key
#
# 用法：
#   approve-gate.sh --approve  --by <你的标识> [--note "..."] [--key <私钥>] [--progress progress.json] [--no-commit]
#   approve-gate.sh --reject   --by <你的标识> [--note "..."] [--key <私钥>]
#   approve-gate.sh --show                      只看当前待批闸门

set -euo pipefail
ACTION=""; BY=""; NOTE=""; PROG="progress.json"; COMMIT=1; KEY_ARG=""
OPENSSL="${OPENSSL_BIN:-openssl}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUB="$HERE/console.pub"

while [ $# -gt 0 ]; do
  case "$1" in
    --approve)  ACTION="approve"; shift ;;
    --reject)   ACTION="reject"; shift ;;
    --show)     ACTION="show"; shift ;;
    --by)       BY="$2"; shift 2 ;;
    --note)     NOTE="$2"; shift 2 ;;
    --key)      KEY_ARG="$2"; shift 2 ;;
    --progress) PROG="$2"; shift 2 ;;
    --no-commit) COMMIT=0; shift ;;
    *) echo "[gate] ⛔ 未知参数：$1" >&2; exit 2 ;;
  esac
done

[ -f "$PROG" ] || { echo "[gate] ⛔ 不存在：$PROG" >&2; exit 2; }

if [ "$ACTION" = "show" ] || [ -z "$ACTION" ]; then
  python3 - "$PROG" <<'PY'
import json, sys
g = (json.load(open(sys.argv[1])) or {}).get("pending_gate")
if not g:
    print("[gate] 当前无待批闸门"); sys.exit(0)
print(f"闸门 {g['id']}")
print(f"  类型    {g['kind']}")
print(f"  批次    {g['batch']}   {g.get('from_status')} → {g.get('to_status')}")
print(f"  举起于  {g['raised_at']}  by {g['raised_by']}")
print(f"  说明    {g['detail']}")
for e in (g.get("evidence") or []):
    print(f"  取证    {e}")
d = g.get("decision")
print(f"  决策    {'待批' if not d else d['action'] + ' by ' + d['by'] + ' @ ' + d['at']}")
PY
  [ "$ACTION" = "show" ] && exit 0
  echo "[gate] 需指定 --approve / --reject / --show" >&2; exit 2
fi

[ -n "$BY" ] || { echo "[gate] ⛔ 缺 --by <你的标识> —— 批准必须可归属" >&2; exit 2; }

# ── 私钥解析：**在写盘之前**做完 ─────────────────────────────────────────────
# 顺序很重要：验签模式下拿不到私钥就必须当场退出。若先写后查，留下的是一条永远
# 过不了 guard 的 decision——而 hook 是 fail-closed 的，那会把整个批次卡死到人工回滚为止。
KEYFILE=""; CLEANUP_KEY=""
if [ -f "$PUB" ]; then
  CAND="$KEY_ARG"
  [ -z "$CAND" ] && CAND="${HARNESS_CONSOLE_KEY:-}"
  [ -z "$CAND" ] && [ -f "$HOME/.harness-console/console.key" ] && CAND="$HOME/.harness-console/console.key"
  if [ -z "$CAND" ]; then
    echo "[gate] ⛔ 本项目已启用验签模式（存在 ${PUB}），批准必须签名，但没找到私钥。" >&2
    echo "   三选一：" >&2
    echo "     · 本机批准： --key <console.key 路径>（或放到 ~/.harness-console/console.key）" >&2
    echo "     · 钥匙串：   --key keychain:<服务名>" >&2
    echo "     · 从控制台批准（控制台持同一把私钥）" >&2
    echo "   ⚠️ 没有私钥就没有批准权，这正是「人闸门归人」的物理含义——不要为了绕开它删掉 console.pub。" >&2
    exit 2
  fi
  case "$CAND" in
    keychain:*)
      SVC="${CAND#keychain:}"
      command -v security >/dev/null 2>&1 || { echo "[gate] ⛔ 无 security 命令，钥匙串取钥不可用" >&2; exit 2; }
      KEYFILE="$(mktemp)"; CLEANUP_KEY="$KEYFILE"; chmod 600 "$KEYFILE"
      security find-generic-password -w -s "$SVC" > "$KEYFILE" 2>/dev/null \
        || { echo "[gate] ⛔ 钥匙串里没有服务名为 $SVC 的条目（或你拒绝了授权）" >&2; exit 2; }
      ;;
    *) KEYFILE="$CAND"
       [ -f "$KEYFILE" ] || { echo "[gate] ⛔ 私钥不存在：$KEYFILE" >&2; exit 2; } ;;
  esac
  trap 'rm -f "$CLEANUP_KEY"; true' EXIT

  # 私钥与仓库里的 console.pub 必须是一对。不校验的话，用错密钥（比如轮换后拿了旧的）
  # 会一路签到底，直到 guard 拒收才发现——而那时 commit 已经落下去了。
  if ! diff -q <("$OPENSSL" pkey -in "$KEYFILE" -pubout 2>/dev/null) "$PUB" >/dev/null 2>&1; then
    echo "[gate] ⛔ 这把私钥与仓库里的 console.pub 不是一对（或 openssl 读不出私钥）。" >&2
    echo "   用错密钥签出来的批准 guard 一定拒收。核对：openssl pkey -in <key> -pubout" >&2
    exit 2
  fi
fi

BACKUP="$(mktemp)"; cp "$PROG" "$BACKUP"
trap 'rm -f "$BACKUP" "$CLEANUP_KEY"; true' EXIT
# 任何一步失败都把 progress.json 原样退回：这个脚本要么留下一条能通过 guard 的批准，
# 要么什么都不留——不存在中间态。
restore() { cp "$BACKUP" "$PROG"; }

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PAY="$(mktemp)"
if ! python3 - "$PROG" "$ACTION" "$BY" "$NOTE" "$NOW" "$PAY" <<'PY'
import json, sys
path, action, by, note, now, pay_path = sys.argv[1:7]
prog = json.load(open(path))
g = prog.get("pending_gate")
if not g:
    print("[gate] ⛔ 当前无待批闸门，无可批准"); sys.exit(2)
if g.get("decision"):
    print(f"[gate] ⛔ 闸门 {g['id']} 已有决策（{g['decision']['action']} by {g['decision']['by']}），"
          f"不覆盖。如需改判，请让机器先消费再重新举闸门。"); sys.exit(2)
d = {"gate_id": g["id"], "action": action, "by": by, "at": now, "scope": {"once": True}}
if note: d["note"] = note
g["decision"] = d
json.dump(prog, open(path, "w"), ensure_ascii=False, indent=2)
open(path, "a").write("\n")
# 待签载荷 = decision 除 sig 外的全部字段，键排序 + 紧凑分隔符 + UTF-8。
# 必须与 validate-pending-gate.sh 和控制台服务端**逐字节一致**——三处实现只要差一个字节，
# 表现就是「批准了却不生效」，而那极难排查。
open(pay_path, "wb").write(
    json.dumps(d, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode())
print(f"[gate] ✓ 闸门 {g['id']} 已{'批准' if action=='approve' else '驳回'}（by {by}，最小授权：仅此一次）")
PY
then
  rm -f "$PAY"; restore; exit 2
fi

# ── 签名（验签模式）──────────────────────────────────────────────────────────
if [ -f "$PUB" ]; then
  SIGBIN="$(mktemp)"
  if ! "$OPENSSL" pkeyutl -sign -rawin -inkey "$KEYFILE" -in "$PAY" -out "$SIGBIN" 2>/dev/null; then
    echo "[gate] ⛔ 签名失败。Ed25519 需要 OpenSSL 3.x —— macOS 自带的是 LibreSSL，不支持 -rawin。" >&2
    echo "   装一个：brew install openssl@3，然后 OPENSSL_BIN=\$(brew --prefix)/opt/openssl@3/bin/openssl 重跑。" >&2
    rm -f "$PAY" "$SIGBIN"; restore; exit 2
  fi
  SIG="$(base64 < "$SIGBIN" | tr -d '\n')"
  rm -f "$SIGBIN"
  python3 - "$PROG" "$SIG" <<'PY'
import json, sys
path, sig = sys.argv[1], sys.argv[2]
prog = json.load(open(path))
prog["pending_gate"]["decision"]["sig"] = sig
json.dump(prog, open(path, "w"), ensure_ascii=False, indent=2)
open(path, "a").write("\n")
print("[gate] ✓ 已用本机私钥签名（不经控制台）")
PY
fi
rm -f "$PAY"

# ── 自检：schema 总是跑，guard 的时机**按模式分开** ──────────────────────────
# 🔴 guard 是 fail-closed 的 PostToolUse 守门：一条过不了 guard 的 decision 一旦落进仓库，
# agent 之后每次写 progress.json 都会被拦死，批次卡到人工回滚为止。所以必须自检。
# 但两种模式的 guard 判据不同，自检时机也就不同：
#   · 验签模式：判据是签名，与 commit 无关 → **提交前**拦住，坏批准一步都不落盘
#   · 比对 HEAD：判据就是「decision 是否随 HEAD 到达」→ 提交前必然失败，只能**提交后**查
if ! bash "$HERE/validate-pending-gate.sh" schema "$PROG"; then
  echo "[gate] ⛔ schema 自检未过，已原样退回 ${PROG}（未改动、未提交）" >&2; restore; exit 2
fi
if [ -f "$PUB" ] && ! bash "$HERE/validate-pending-gate.sh" guard "$PROG"; then
  echo "[gate] ⛔ guard 自检未过，已原样退回 ${PROG}（未改动、未提交）" >&2; restore; exit 2
fi

if [ "$COMMIT" -eq 1 ] && git rev-parse --git-dir >/dev/null 2>&1; then
  GID="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['pending_gate']['id'])" "$PROG")"
  PREV="$(git rev-parse HEAD 2>/dev/null || echo '')"
  git add "$PROG"
  git commit -q -m "chore(gate): ${ACTION} ${GID} by ${BY}" || true
  if bash "$HERE/validate-pending-gate.sh" guard "$PROG" >/dev/null 2>&1; then
    echo "[gate] ✓ 已提交并自检通过。本机 guard 放行；其他机器 \`git pull\` 后同样放行。"
    echo "[gate]   如需其他机器立刻看到，记得 git push。"
  else
    # 不自动回滚：改写历史比留下一条坏 decision 更危险（可能连带别人的改动）。
    # 给出确切的回退命令，让你自己决定。
    echo "[gate] ⛔ 提交后 guard 仍不放行 —— 这条 decision 会卡住 agent 的后续写入。" >&2
    [ -n "$PREV" ] && echo "   回退：git reset --soft ${PREV} && git checkout -- ${PROG}" >&2
    exit 2
  fi
else
  echo "[gate] ⚠️ 未提交（--no-commit 或非 git 仓库）。"
  [ -f "$PUB" ] || echo "[gate]   未配 console.pub 时 guard 走「比对 HEAD」，未提交前会把它当本地改动而拒绝 agent 的后续写入。"
fi

# ── 加固（可选，只在私钥与 agent 同机时才需要考虑）──────────────────────────
# 私钥放在本机文件里，跑在同一台机器上的 agent 原则上也读得到——「agent 伪造不了签名」
# 这条保证就退化成文件权限 + 你对 agent 的约束。要把它拿回来，把私钥放进钥匙串并要求确认：
#   security add-generic-password -s harness-console -a "$USER" -w "$(cat console.key)" -T ""
#   ! bash .claude/console/approve-gate.sh --approve --by <你> --key keychain:harness-console
# `-T ""` 表示不信任任何程序，每次取用都会弹系统授权框——无人值守的 agent 过不去这一关。
