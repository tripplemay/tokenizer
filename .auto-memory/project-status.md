---
name: project-status
description: 项目当前状态快照（覆盖写，≤30 行）— 当前批次、计划、决策、遗留问题
type: project
---
## 当前批次

- **BL-TOKENIZER-ADOPT-V170：done（2026-08-06）+ rollout 已执行**。tokenizer 采纳框架 v1.7.0（3/3 全 PASS，闸门验签批准）。三条 rollout 已落地：本机 Agent 应用包 ~/.tokenizer/app 已 checkout 到 v1.7.0（2fb4b15，daemon 重启 pid 正常）；机器契约已迁移（provider.json 补 image_location、bundle 补 kimi_identity）；最终真机 planner launch 在正式应用包上 RETURNED/completed（89s）。本机 bridge 现用 v1.7.0 provider、可用。当前无进行中批次。
- 上游 harness-template v1.7.0 已发布并 push（github.com/tripplemay/harness-template，e91fbbc + 全部 tag）。newkolmatrix 的 .claude/dispatch 已升 v1.7.0（local-cli Kimi 可见，42 文件待用户在该仓提交）。
- backlog：BL-REGISTRY-LAZY-FIELD-CLEANUP、BL-BRIDGE-GUEST-FAILURE-TAXONOMY、BL-BRIDGE-D8-D9-OVERWRITE-ALIGNMENT。
- proposed-learnings 待用户确认（persona 不外推；spawn 边界须真实 argv 用例）。

## 已知边界

- 2026-08-04 用户批准推送部署：capability-9（Agent 1.2.1 + device_reporter_observability 迁移）与全部 evaluator 复现脚本已合入 main 并部署 success（生产运行 a7bf556）；hold 分支已删除。BL-AGENT-SINGLE-INSTANCE-LIFECYCLE 的独立验收批次仍待从 backlog 消费。本机 Agent 将收到 1.2.1 升级提示。
- 本机 `.claude/dispatch/agents-registry.example.json` 是用户本地定制，必须保留且不得提交。
- Kimi access token TTL ≈ 15 分钟；bridge launch 前如过期需先以最小 kimi -p 调用刷新（fail-closed 设计）。
