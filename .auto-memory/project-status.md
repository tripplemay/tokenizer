---
name: project-status
description: 项目当前状态快照（覆盖写，≤30 行）— 当前批次、计划、决策、遗留问题
type: project
---
## 当前批次

- **BL-HARNESS-DETAIL-MODEINTENT（building）**：Harness 项目卡下钻、签名模式意图、下一次 `/plan` 消费、脱敏 dispatch 历史。
- 用户已确认：执行/角色与自治策略同时开放；不影响当前批次；dispatch 摘要需要持久化。
- Generator=`builder-codex` local-cli；Evaluator=`reviewer-kimi-a2a` loopback，family 互斥成立。
- F001 先在 harness-template 建通用契约并同步；F002-F005 落 tokenizer；F006 独立验收。
- Spec：`docs/specs/BL-HARNESS-DETAIL-MODEINTENT-spec.md`。

## 上一批次

- **BL-MODESCMD ✅ done（2026-07-27）**：`tokenizer harness --modes`；Codex 外部 generator + Kimi evaluator，单轮 PASS。

## 生产状态

- 本批尚未部署；新增 migration 计划为 additive。源代码推 main 会触发 CI，部署仍由用户手动触发。

## 已知 gap

- A2A 仅做 loopback 验收，真实跨物理机仍不在本批范围。
- Harness 详情页无既有 Stitch/design-draft 原型，本批按现有控制台视觉系统新增布局并做 Playwright 双 viewport 验证。
