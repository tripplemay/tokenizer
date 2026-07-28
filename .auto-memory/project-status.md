---
name: project-status
description: 项目当前状态快照（覆盖写，≤30 行）— 当前批次、计划、决策、遗留问题
type: project
---
## 当前批次

- **BL-HARNESS-DETAIL-MODEINTENT（reverifying，6/6 completed，fix_round 1）**：Harness 项目卡下钻、签名模式意图、下一次 `/plan` 消费、脱敏 dispatch 历史。
- 用户已确认：执行/角色与自治策略同时开放；不影响当前批次；dispatch 摘要需要持久化。
- Generator=`builder-codex` local-cli；修复轮 Evaluator=`reviewer-kimi` local-cli fallback，family 互斥成立。
- Kimi 锁定 `697d4a4` 的修复轮 verdict：F003/F006 PASS，90/90 聚焦、22/22 对抗探测通过。
- Signoff 后真实 agent 上报发现 `/plan` 被敏感路径误判，原 gate/signoff 已撤回。
- F003 窄修复 `41b64dd` 已部署并通过真实上报；`reverifying -> done` 人工 gate 待批准。

## 上一批次

- **BL-MODESCMD ✅ done（2026-07-27）**：`tokenizer harness --modes`；Codex 外部 generator + Kimi evaluator，单轮 PASS。

## 生产状态

- 修复链已部署到 `https://token.vpanel.cc`；GitHub Actions run `30323387595` 的 Linux、Windows、VPS Deploy 三段成功。
- 部署后 `npm run cli -- harness` 为 `Reported: 6`，tokenizer 不再出现在 400 skip 列表。

## 已知 gap

- A2A 首轮 loopback 成功；修复轮暴露 runner/watchdog 超时不收束，Kimi local-cli fallback 成功，需另批修复传输层。
- Harness 详情页无既有 Stitch/design-draft 原型，本批按现有控制台视觉系统新增布局并做 Playwright 双 viewport 验证。
