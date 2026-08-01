---
name: project-status
description: 项目当前状态快照（覆盖写，≤30 行）— 当前批次、计划、决策、遗留问题
type: project
---
## 当前批次

- **BL-AGENT-REPORT-COMPAT（done，4/4）**：修复旧 Agent 因工具目录协议升级导致 Harness report 被 `invalid_tool_catalog` 拒绝，以及首页未提示该本机 Agent 更新的问题。
- 旧安装副本报告 feature 6 / release `1.0.0`，在 `tool-integrations/1` 下生成 `dispatch.enabled=false` 和空 `toolCatalog`；服务端误把空遗留目录按新版可用目录验证，`reportedAt` 因此不刷新。
- F001 仅兼容这一精确空目录形状，仍禁止将它用于 v2 签发；F002 已发布 Agent `1.1.0` / capability 7；F003 已补齐 outdated/unknown 首页语义；F004 已由 fresh Kimi A2A Evaluator 全量验收通过。
- 无新签名 mode intent，使用默认快车道；`BL-AGENT-REPORT-COMPAT-verifying-done-w1` 已由 `tripplemay` 签名批准并消费，生产与本机 Agent 收敛均已完成。
- 本机 `.claude/dispatch/agents-registry.example.json` 是用户本地定制，必须保留且不得提交。

## 最近发布

- 产品 `1ea3ebe` 已部署，Actions `30676280404` 的 Verify、Windows Verify、Deploy 均成功；公开 `/api/health` 回报该 commit。本机 Agent 已更新为 release `1.1.0` / capability 7，Harness 实测 `reported=9`、`failed=0`。
- Harness framework `f518682`（v1.6.1）已推送；本批不修改 framework、Prisma schema 或用户保存的下批次模式意图。

## 已知边界

- Git SHA 仅作诊断，不作为升级顺序；正式 release + capability 是可操作的兼容合同。
- 旧 Agent 在兼容服务端恢复 report 后仍不得签发 tool-bound intent，直至更新到 capability 7；现场 daf106c 快照已被新 parser 接受，但 v2 catalog 提取仍拒绝。
