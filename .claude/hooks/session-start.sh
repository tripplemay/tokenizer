#!/usr/bin/env bash
# SessionStart hook — 会话启动时自动注入状态机现状（harness-rules.md §机制化守门）
# 目的：把「启动必读 progress.json」从模型自觉变成机制注入，防止无角色状态下随手改代码。

if [ ! -f progress.json ]; then
  exit 0
fi

python3 - <<'PY'
import json

try:
    p = json.load(open("progress.json"))
except Exception as e:
    print(f"[harness] ⚠️ progress.json 解析失败（{e}），修复后才能进入状态机流程。")
    raise SystemExit(0)

status = p.get("status", "unknown")
role_map = {
    "new": "planner", "planning": "planner", "done": "planner",
    "building": "generator", "fixing": "generator",
    "verifying": "evaluator（隔离 subagent / 独立实例）",
    "reverifying": "evaluator（隔离 subagent / 独立实例）",
}
print(f"[harness] 当前状态机 status={status} → 本阶段角色：{role_map.get(status, '未知')}")
print(f"[harness] 批次进度：{p.get('completed_features', 0)}/{p.get('total_features', 0)}，fix_rounds={p.get('fix_rounds', 0)}，current_sprint={p.get('current_sprint') or '无'}")
if p.get("role_assignments"):
    print(f"[harness] role_assignments 生效：{json.dumps(p['role_assignments'], ensure_ascii=False)}")
print("[harness] 按 harness-rules.md 启动流程执行：先 git pull --ff-only，加载 T0 记忆，再进入角色（/plan /build /verify）。")
PY

exit 0
