---
name: project-status
description: 项目当前状态快照（覆盖写，≤30 行）— 当前批次、计划、决策、遗留问题
type: project
---
## 当前批次

- **BL-NATIVE-SUBAGENT-BRIDGES：done（2026-08-04）**。5/5 全 PASS，3 轮修复；人工闸门经控制台验签批准。signoff：`docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-signoff-2026-08-04.md`。
- 交付能力：vm-v1 strict provider（Lima VM + brokered 凭据/网络）驱动 Kimi 三 persona 同会话子代理 bridge；声明式 deliverable_channels（planner=terminal-message）；nonce-bound child receipt 全链证据；Codex 保持 local-cli。生产运行 4cf44df。
- backlog 现有：BL-AGENT-CATALOG-RELEASE-RECOVERY（实现已在 c5fe6be，待作独立批次验收消费）、BL-AGENT-SINGLE-INSTANCE-LIFECYCLE（代码在 hold 分支）、BL-REGISTRY-LAZY-FIELD-CLEANUP。
- 非阻断观察待裁量入 backlog：guest 失败类别白名单回传；terminal-message O_EXCL 与 D9 覆盖语义对齐。

## 已知边界

- capability-9 在本地分支 `backlog/bl-agent-single-instance-lifecycle`（cadb65f，含 DB 迁移 + Agent 1.2.1）；evaluator 复现脚本在 `evaluator-artifacts-hold`（fbe92b3）。**推送即部署，窗口归用户。**
- 本机 `.claude/dispatch/agents-registry.example.json` 是用户本地定制，必须保留且不得提交。
- Kimi access token TTL ≈ 15 分钟；bridge launch 前如过期需先以最小 kimi -p 调用刷新（fail-closed 设计）。
