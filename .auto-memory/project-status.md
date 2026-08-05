---
name: project-status
description: 项目当前状态快照（覆盖写，≤30 行）— 当前批次、计划、决策、遗留问题
type: project
---
## 当前批次

- **BL-AGENT-RELEASE-ACCEPTANCE：done（2026-08-04）**。首轮 3/3 全 PASS；两个 Agent 发布的独立验收补齐；本机真实升级链路成功，现运行 1.2.1 单实例。signoff：docs/test-reports/BL-AGENT-RELEASE-ACCEPTANCE-signoff-2026-08-04.md。当前无进行中批次。
- 上一批次 BL-NATIVE-SUBAGENT-BRIDGES 已 done（5/5 全 PASS，signoff 落盘，闸门验签批准）。
- backlog 现有：BL-REGISTRY-LAZY-FIELD-CLEANUP、BL-BRIDGE-GUEST-FAILURE-TAXONOMY、BL-BRIDGE-D8-D9-OVERWRITE-ALIGNMENT。
- proposed-learnings 两条待用户确认（persona 不外推；spawn 边界须真实 argv 用例）。

## 已知边界

- 2026-08-04 用户批准推送部署：capability-9（Agent 1.2.1 + device_reporter_observability 迁移）与全部 evaluator 复现脚本已合入 main 并部署 success（生产运行 a7bf556）；hold 分支已删除。BL-AGENT-SINGLE-INSTANCE-LIFECYCLE 的独立验收批次仍待从 backlog 消费。本机 Agent 将收到 1.2.1 升级提示。
- 本机 `.claude/dispatch/agents-registry.example.json` 是用户本地定制，必须保留且不得提交。
- Kimi access token TTL ≈ 15 分钟；bridge launch 前如过期需先以最小 kimi -p 调用刷新（fail-closed 设计）。
