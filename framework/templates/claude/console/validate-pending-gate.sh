#!/usr/bin/env bash
# console-mode.md 闸门契约校验器。三种用途：
#
#   validate-pending-gate.sh schema [progress.json]   形状 + gate_id 一致性
#   validate-pending-gate.sh guard  [progress.json]   🔴 防自我盖章：decision 不得由本地 agent 写入
#   validate-pending-gate.sh hook                     PostToolUse：写 progress.json 时跑 schema+guard
#
# 退出码：0 通过 / 2 校验失败（fail-closed）
#
# ── guard 是本文件存在的理由 ──
# `pending_gate.decision` 是「人类批准」这件事在 git 里的唯一表示。若 agent 能写它，
# 那么「阶段推进键归人」「L2 需授权」这些红线就全部退化成自觉——agent 只要给自己写一条
# approve 就能跨过任何闸门。工具层拦不住（progress.json 必须允许 agent 写 status），
# 所以在**内容层**拦：比对工作区与 HEAD，decision 若是本地新增/修改即拒。
#
# 合法路径：
#   · 人类跑 approve-gate.sh（Bash 不触发 PostToolUse hook）→ 写入并立即 commit
#   · 控制台经 GitHub API 提交 → agent 侧 `git pull` 后 HEAD 已含该 decision → guard 放行
# 非法路径：
#   · agent 用 Write/Edit 直接写 decision → hook 当场拒
#   · agent 举新闸门时顺手带上 decision → 拒
#   · agent 篡改已有 decision（如把 once 改成永久）→ 拒
# 允许：agent 消费完批准后把整个 pending_gate 置 null（这是正常收尾，不是盖章）
#
# 两种模式（各自 fail-closed）：
#   ① 无 console.pub → 比对工作区与 HEAD（git 传输路径）
#   ② 有 console.pub → 验 Ed25519 签名（推荐；支持 device agent 中继，控制台不需要 git 写权限）

set -euo pipefail
MODE="${1:-hook}"
PROG="${2:-progress.json}"

if [ "$MODE" = "hook" ]; then
  INPUT=$(cat)
  FP=$(printf '%s' "$INPUT" | python3 -c "
import json,sys
try: print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))
except Exception: pass
")
  [ "$(basename "$FP" 2>/dev/null)" = "progress.json" ] || exit 0
  "$0" schema "$FP" || exit 2
  exec "$0" guard "$FP"
fi

[ -f "$PROG" ] || { echo "[gate] ⛔ 不存在：$PROG"; exit 2; }

case "$MODE" in

schema)
  python3 - "$PROG" <<'PY'
import json, sys
p = sys.argv[1]
try: prog = json.load(open(p))
except Exception as e: print(f"[gate] ⛔ progress.json 非法：{e}"); sys.exit(2)

g = prog.get("pending_gate")
if g is None:
    print("[gate] ✓ 无待批闸门"); sys.exit(0)
if not isinstance(g, dict):
    print("[gate] ⛔ pending_gate 必须为对象或 null"); sys.exit(2)

KINDS = {"phase_advance","l2_auth","adjudication","debias_conflict","scope_drift","budget","spec_lock","other"}
BY    = {"autodriver","verify","build","plan","dispatch"}
ALLOWED = {"id","kind","raised_at","raised_by","batch","from_status","to_status","detail","evidence","decision"}
errs = []

extra = set(g) - ALLOWED
if extra: errs.append(f"含白名单外字段 {sorted(extra)}")
for k in ("id","kind","raised_at","raised_by","batch","detail"):
    if not g.get(k): errs.append(f"缺必填字段 {k}")
if g.get("kind") not in KINDS:      errs.append(f"kind 非法：{g.get('kind')!r}")
if g.get("raised_by") not in BY:    errs.append(f"raised_by 非法：{g.get('raised_by')!r}")
if len(str(g.get("id",""))) < 8:    errs.append("id 过短——幂等键须足够唯一")

d = g.get("decision")
if d is not None:
    if not isinstance(d, dict):
        errs.append("decision 必须为对象或 null")
    else:
        dextra = set(d) - {"gate_id","action","by","at","note","scope","sig"}
        if dextra: errs.append(f"decision 含白名单外字段 {sorted(dextra)}")
        for k in ("gate_id","action","by","at"):
            if not d.get(k): errs.append(f"decision 缺必填字段 {k}")
        if d.get("action") not in ("approve","reject"):
            errs.append(f"decision.action 非法：{d.get('action')!r}")
        # 陈旧批准防护：一张批准只对它自己那个闸门有效
        if d.get("gate_id") and d.get("gate_id") != g.get("id"):
            errs.append(f"decision.gate_id={d.get('gate_id')!r} ≠ gate.id={g.get('id')!r} "
                        f"—— 陈旧批准不得解锁另一个闸门")

if errs:
    print(f"[gate] ⛔ pending_gate 校验失败（{p}）：")
    for e in errs: print("   -", e)
    sys.exit(2)
d = g.get("decision")
print(f"[gate] ✓ 闸门 {g['id']}（{g['kind']}）"
      + (f" 已{'批准' if d['action']=='approve' else '驳回'} by {d['by']}" if d else " 待批"))
PY
  ;;

guard)
  # ── 模式 ②：配了公钥 → 验签（推荐）──────────────────────────────────────
  # 签名把「谁批准的」从**传输路径**转移到**内容本身**：控制台持私钥，写代码的 agent
  # 读得到公钥却伪造不了签名。于是「本地写入」不再可疑，
  # 「控制台签名 → device agent 中继 → 本机落盘」这条通道才成立（不需要 git push 权限）。
  PUB="$(dirname "${BASH_SOURCE[0]}")/console.pub"
  if [ -f "$PUB" ]; then
    command -v openssl >/dev/null 2>&1 || { echo "[gate] ⛔ 配了 console.pub 但无 openssl，无法验签"; exit 2; }
    PAY="$(mktemp)"; SIG="$(mktemp)"; trap 'rm -f "$PAY" "$SIG"' EXIT
    RC=$(python3 - "$PROG" "$PAY" "$SIG" <<'PY'
import base64, json, sys
prog_path, pay_path, sig_path = sys.argv[1:4]
try: prog = json.load(open(prog_path))
except Exception as e: print(f"ERR progress.json 非法：{e}"); sys.exit(0)
g = prog.get("pending_gate")
if not isinstance(g, dict): print("SKIP 闸门已清空"); sys.exit(0)
d = g.get("decision")
if d is None: print("SKIP 尚无决策"); sys.exit(0)
sig = d.get("sig")
if not sig:
    print("ERR decision 缺 sig —— 本仓库已配 console.pub，未签名的决策一律拒收"); sys.exit(0)
# 规范化载荷 = decision 里**除 sig 外的全部字段**，键排序 + 紧凑分隔符 + UTF-8。
# ⚠️ 必须签全字段，不能只签 {action,at,by,gate_id}：否则 scope 这类未签字段可被 agent 篡改
# （把 once:true 改成永久授权）而签名依然有效——实测踩到过。
payload = json.dumps({k: v for k, v in d.items() if k != "sig"},
                     sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
open(pay_path, "wb").write(payload)
try: open(sig_path, "wb").write(base64.b64decode(sig, validate=True))
except Exception as e: print(f"ERR sig 不是合法 base64：{e}"); sys.exit(0)
print("VERIFY")
PY
)
    case "$RC" in
      SKIP*) echo "[gate] ✓ guard（验签模式）：${RC#SKIP }"; exit 0 ;;
      ERR*)  echo "[gate] ⛔ guard（验签模式）：${RC#ERR }"; exit 2 ;;
    esac
    if openssl pkeyutl -verify -pubin -inkey "$PUB" -rawin -in "$PAY" -sigfile "$SIG" >/dev/null 2>&1; then
      # 说「持私钥者」而非「控制台」：签名只证明签发者持有私钥，而私钥有两个合法持有者
      # ——控制台服务端，和用 approve-gate.sh --key 在本机批准的人类。
      echo "[gate] ✓ guard（验签模式）：decision 签名有效（由持私钥者签发）"; exit 0
    fi
    echo "[gate] ⛔ guard（验签模式）：**签名无效** —— 该 decision 不是控制台签发的。"
    echo "   载荷被篡改，或有人试图伪造批准。人闸门必须由控制台或持私钥的人类签发。"
    exit 2
  fi

  # ── 模式 ①：无公钥 → 比对工作区与 HEAD（git 传输路径）────────────────────
  if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "[gate] ⚠️ 非 git 仓库且未配 console.pub，跳过 guard（decision 来源无法验证）"; exit 0
  fi
  # ⚠️ HEAD 内容必须走临时文件传参，不能用管道：`python3 - <<'PY'` 的 heredoc 会占据 stdin，
  #    管道内容读不到，head 恒为空 → 任何 decision 都被误判成「本地新增」而拒绝合法批准。
  HEAD_TMP="$(mktemp)"; trap 'rm -f "$HEAD_TMP"' EXIT
  git show "HEAD:./$(basename "$PROG")" > "$HEAD_TMP" 2>/dev/null || : > "$HEAD_TMP"
  python3 - "$PROG" "$HEAD_TMP" <<'PY'
import json, sys
work_path, head_path = sys.argv[1], sys.argv[2]
head_raw = open(head_path).read()

def dec_of(raw_or_obj, is_raw):
    try:
        obj = json.loads(raw_or_obj) if is_raw else raw_or_obj
    except Exception:
        return "__UNPARSEABLE__"
    g = (obj or {}).get("pending_gate")
    if not isinstance(g, dict):
        return None
    return g.get("decision")

try: work = json.load(open(work_path))
except Exception as e: print(f"[gate] ⛔ 工作区 progress.json 非法：{e}"); sys.exit(2)

work_gate = work.get("pending_gate")
# 清空整个闸门 = agent 消费完批准后的正常收尾，放行
if work_gate is None:
    print("[gate] ✓ guard：闸门已清空（消费收尾）"); sys.exit(0)

head_dec = dec_of(head_raw, True) if head_raw.strip() else None
if head_dec == "__UNPARSEABLE__":
    head_dec = None
work_dec = work_gate.get("decision") if isinstance(work_gate, dict) else None

if work_dec != head_dec:
    print("[gate] ⛔ guard：`pending_gate.decision` 是本地新增/修改的 —— 拒绝。")
    print("   人类批准必须经这两条路径之一，agent 不得代劳（否则「人闸门归人」退化成自觉）：")
    print("     · 你自己跑： ! bash .claude/console/approve-gate.sh --approve --by <你>")
    print("     · 控制台批准后 `git pull`，decision 随 HEAD 到达即自动放行")
    print(f"   HEAD 中的 decision：{json.dumps(head_dec, ensure_ascii=False)}")
    print(f"   工作区的 decision：{json.dumps(work_dec, ensure_ascii=False)}")
    sys.exit(2)
print("[gate] ✓ guard：decision 未被本地改动")
PY
  ;;

*)
  echo "用法: validate-pending-gate.sh {schema|guard|hook} [progress.json]" >&2; exit 2 ;;
esac
