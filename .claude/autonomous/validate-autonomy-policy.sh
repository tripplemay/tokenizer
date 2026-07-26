#!/usr/bin/env bash
# autonomous-mode.md 机件 #1：autonomy-policy.json 内容校验（fail-closed）。
# 两用：(a) 作为 PostToolUse Write|Edit 到 autonomy-policy.json 的校验；
#        (b) /autodrive 启动前置断言直接调用（机件在位 = 开车前置条件）。
# fail-closed：文件缺失 / 过期 / 非法 → 退出 2（阻断自主）。
# 注意：真正的时间判断在此完成（bash/python 可用 datetime）；Workflow 内 Date 不可用，故时间门放在本 hook。

set -euo pipefail
POLICY="${1:-autonomy-policy.json}"

if [ ! -f "$POLICY" ]; then
  echo "[autodrive] ⛔ autonomy-policy.json 缺失 → fail-closed，自主不得开启。"
  exit 2
fi

python3 - "$POLICY" <<'PY'
import json, sys, datetime
path = sys.argv[1]
try:
    p = json.load(open(path))
except Exception as e:
    print(f"[autodrive] ⛔ 策略 JSON 非法（{e}）→ fail-closed。"); sys.exit(2)

errs = []
if p.get("enabled") is not True:
    errs.append("enabled 非 true")
if p.get("authorized_by") != "user":
    errs.append("authorized_by 必须为 'user'（只有人类可授权）")

ac = p.get("auto_cross", [])
bad = [c for c in ac if c not in ("A", "B")]
if bad:
    errs.append(f"auto_cross 含非法类 {bad}（C 类不可逆/花钱动作结构性不可授权）")

exp = p.get("expires_at")
if not exp:
    errs.append("缺 expires_at")
else:
    try:
        t = datetime.datetime.fromisoformat(exp.replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=datetime.timezone.utc)
        if t <= datetime.datetime.now(datetime.timezone.utc):
            errs.append(f"策略已于 {exp} 过期 → fail-closed")
    except Exception:
        errs.append(f"expires_at 格式非法（需 ISO-8601 带 Z）：{exp}")

b = p.get("budget", {})
for k in ("max_tokens", "max_cost_usd", "max_wakes", "max_fix_rounds"):
    if k not in b:
        errs.append(f"budget 缺 {k}")

if errs:
    print("[autodrive] ⛔ 策略校验失败 → fail-closed，自主不得开启：")
    for e in errs:
        print("   -", e)
    sys.exit(2)
print(f"[autodrive] ✓ autonomy-policy.json 合法且未过期（batch_scope={p.get('batch_scope')}）。")
PY
