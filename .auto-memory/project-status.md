---
name: project-status
description: 项目当前状态快照（覆盖写，≤30 行）— 当前批次、计划、决策、遗留问题
type: project
---
## 当前批次

- **BL-TOKENIZER-ADOPT-V170：done（2026-08-06）**。tokenizer 采纳框架 v1.7.0（3/3 全 PASS，闸门验签批准）。含真机验证的 A 血统 vm-v1 provider（6 个 launch 修复）、deliverable_channels、铁律13、codex 硬化、MAX_PROVIDER_BYTES 128→256KB 修复。当前无进行中批次。
- 上游 harness-template v1.7.0 已发布并 push（github.com/tripplemay/harness-template，e91fbbc + 全部 tag）。newkolmatrix 的 .claude/dispatch 已升 v1.7.0（local-cli Kimi 可见，42 文件待用户在该仓提交）。
- backlog：BL-REGISTRY-LAZY-FIELD-CLEANUP、BL-BRIDGE-GUEST-FAILURE-TAXONOMY、BL-BRIDGE-D8-D9-OVERWRITE-ALIGNMENT。
- proposed-learnings 待用户确认（persona 不外推；spawn 边界须真实 argv 用例）。

## 已知边界

- 2026-08-04 用户批准推送部署：capability-9（Agent 1.2.1 + device_reporter_observability 迁移）与全部 evaluator 复现脚本已合入 main 并部署 success（生产运行 a7bf556）；hold 分支已删除。BL-AGENT-SINGLE-INSTANCE-LIFECYCLE 的独立验收批次仍待从 backlog 消费。本机 Agent 将收到 1.2.1 升级提示。
- 本机 `.claude/dispatch/agents-registry.example.json` 是用户本地定制，必须保留且不得提交。
- Kimi access token TTL ≈ 15 分钟；bridge launch 前如过期需先以最小 kimi -p 调用刷新（fail-closed 设计）。
