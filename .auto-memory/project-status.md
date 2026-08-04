---
name: project-status
description: 项目当前状态快照（覆盖写，≤30 行）— 当前批次、计划、决策、遗留问题
type: project
---
## 当前批次

- **BL-NATIVE-SUBAGENT-BRIDGES（reverifying，4/5，fix_rounds=3）**：FIX2 已裁决（#1:A #2:A #3 #4 同意）并于第 3 轮实现（6b8900b+4cf44df）：deliverable_channels 声明式通道、artifact 覆盖点合法化、旧用例清理、backlog 登记。planner persona 真实 launch 冒烟成功（terminal-message 物化，68s）；三 persona 均有真实实证。用户批准 4cf44df 推送（无迁移部署）。聚焦终轮复验进行中。
- 上轮全部阻断项已在 abf7a6e 处理：-I 重解析、write_text(bytes)、dispatch-run 预检路径双拼、guest 目录穿越权限×2；dispatch_common.py 已入三处 app-bundle 身份名单；test-lifecycle 断言已收敛到安全属性；已补生产 argv 回归用例。
- L2 已实际行使（真实 launch 尝试 + Codex local-cli health + 全量回归），不再 l2_pending。
- 复验证据：`docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-reverify-F00{1..5}-2026-08-04.md`、`…-adversarial-review-2026-08-04.md`、`…-F005-probe-audit-2026-08-04.json`、`docs/test-reports/evidence/`。
- 本机 `.claude/dispatch/agents-registry.example.json` 是用户本地定制，必须保留且不得提交。

## 已知边界

- capability-9 工作在本地分支 `backlog/bl-agent-single-instance-lifecycle`（cadb65f）；evaluator 复现脚本（scripts/test/、tests/evaluator/）在本地分支 `evaluator-artifacts-hold`。**两者均未推送——push 会触发生产部署（capability-9 含 DB 迁移），时机由用户决定。**
- 生产当前运行 c5fe6be（2026-08-02 push 自动部署，CI 记录 success）。
- 当前没有 done 人工闸门，也没有 mode intent。
