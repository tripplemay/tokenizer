---
name: project-status
description: 项目当前状态快照（覆盖写，≤30 行）— 当前批次、计划、决策、遗留问题
type: project
---
## 当前批次

- **BL-HARNESS-DETAIL-MODEINTENT（reverifying，6/6 completed，fix_round 1）**：Harness 项目卡下钻、签名模式意图、下一次 `/plan` 消费、脱敏 dispatch 历史。
- 用户已确认：执行/角色与自治策略同时开放；不影响当前批次；dispatch 摘要需要持久化。
- Generator=`builder-codex` local-cli；修复轮 Evaluator=`reviewer-kimi` local-cli fallback，family 互斥成立。
- Kimi 最终锁定 `4aa801f`：F004/F006 PASS，31/31 聚焦；前序 r1b 的 90/90 与 22/22 对抗探测也通过。
- Signoff 后真实 agent 上报发现 `/plan` 被敏感路径误判，原 gate/signoff 已撤回。
- F003 脱敏修复 `41b64dd` 与 F004 gate 白名单修复 `4aa801f` 已部署；`reverifying -> done` 人工 gate 待批准。

## 上一批次

- **BL-MODESCMD ✅ done（2026-07-27）**：`tokenizer harness --modes`；Codex 外部 generator + Kimi evaluator，单轮 PASS。

## 生产状态

- 修复链已部署到 `https://token.vpanel.cc`；GitHub Actions run `30326679863` 的 Linux、Windows、VPS Deploy 三段成功。
- 部署后 `npm run cli -- harness` 为 `Reported: 6`，tokenizer 不再出现在 400 skip 列表。
- 最终全量验证：49 files，619 passed / 4 skipped；verify、targeted lint、production build 全绿。

## 已知 gap

- A2A 首轮 loopback 成功；修复轮暴露 runner/watchdog 超时不收束，Kimi local-cli fallback 成功，需另批修复传输层。
- Harness 详情页无既有 Stitch/design-draft 原型，本批按现有控制台视觉系统新增布局并做 Playwright 双 viewport 验证。
