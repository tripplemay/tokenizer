---
name: project-status
description: 项目当前状态快照（覆盖写，≤30 行）— 当前批次、计划、决策、遗留问题
type: project
---
## 当前批次

- **BL-HARNESS-DETAIL-MODEINTENT（verifying，6/6 PASS）**：Harness 项目卡下钻、签名模式意图、下一次 `/plan` 消费、脱敏 dispatch 历史。
- 用户已确认：执行/角色与自治策略同时开放；不影响当前批次；dispatch 摘要需要持久化。
- Generator=`builder-codex` local-cli；Evaluator=`reviewer-kimi-a2a` loopback，family 互斥成立。
- Kimi 锁定 `91d3d2f` 独立验收 F006 PASS；receipt、L1、迁移与双视口 Playwright 均通过。
- Signoff 已落盘；`verifying -> done` phase_advance 闸门等待人类批准。

## 上一批次

- **BL-MODESCMD ✅ done（2026-07-27）**：`tokenizer harness --modes`；Codex 外部 generator + Kimi evaluator，单轮 PASS。

## 生产状态

- F005 产品提交已部署到 `https://token.vpanel.cc`；GitHub Actions run `30317964879` 三段成功。
- F006 仅新增验收报告、截图和状态机证据，不触发产品部署。

## 已知 gap

- A2A 仅做 loopback 验收，真实跨物理机仍不在本批范围。
- Harness 详情页无既有 Stitch/design-draft 原型，本批按现有控制台视觉系统新增布局并做 Playwright 双 viewport 验证。
