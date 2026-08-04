---
name: project-status
description: 项目当前状态快照（覆盖写，≤30 行）— 当前批次、计划、决策、遗留问题
type: project
---
## 当前批次

- **BL-NATIVE-SUBAGENT-BRIDGES（reverifying，1/5，fix_rounds=2）**：第 2 轮修复 abf7a6e 连修 launch 链路五处缺陷；Generator 已用真实认证 Kimi 冒烟端到端成功（RETURNED/completed，nonce-bound child receipt）。聚焦复验 F003/F005 进行中，F001/F002/F004 上轮 PASS。
- 剩余唯一阻断根因：vm-bridge-provider.py:1799-1818 launch 时以 `python3 -I` 重解析 target，tool-catalog.py 的 dispatch_common sibling 导入在 isolated mode 下必然 ModuleNotFoundError（-I 隐含 -E，PYTHONPATH 不可绕过；本机 python 3.9.6 无 -P）。catalog 侧（ff896dd HOME 修复）已确认有效：三角色发布 kimi subagent、provenance 完整。
- 次要项：test-lifecycle.py 一条过时断言（期望旧拒绝文案；安全属性经独立取证仍成立）。回归缺口：test-vm-bridge-provider 全 mock，未覆盖生产 argv 真实 launch 重解析。
- L2 已实际行使（真实 launch 尝试 + Codex local-cli health + 全量回归），不再 l2_pending。
- 复验证据：`docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-reverify-F00{1..5}-2026-08-04.md`、`…-adversarial-review-2026-08-04.md`、`…-F005-probe-audit-2026-08-04.json`、`docs/test-reports/evidence/`。
- 本机 `.claude/dispatch/agents-registry.example.json` 是用户本地定制，必须保留且不得提交。

## 已知边界

- capability-9 工作在本地分支 `backlog/bl-agent-single-instance-lifecycle`（cadb65f）；evaluator 复现脚本（scripts/test/、tests/evaluator/）在本地分支 `evaluator-artifacts-hold`。**两者均未推送——push 会触发生产部署（capability-9 含 DB 迁移），时机由用户决定。**
- 生产当前运行 c5fe6be（2026-08-02 push 自动部署，CI 记录 success）。
- 当前没有 done 人工闸门，也没有 mode intent。
