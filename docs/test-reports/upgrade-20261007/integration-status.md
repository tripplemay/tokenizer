# 升级候选集成状态（非发布验收）

## 基线与状态机边界

- 原仓 `main` 仍为 `2074991717abaf3cb34d9aad894bcd4357fefbc3`。原 worktree 预存大量 mode-only 工作区变更，本集成树未读取/覆盖这些改动；无 branch push。
- `progress.json.status=verifying`、`current_sprint=BL-HOMEPAGE-FRESHNESS`；`features.json` F005 仍 `pending`，`pending_gate=null`。当前升级修复采用独立 hotfix 候选树，**不冒充旧批次 F005 签收**，不写 `pending_gate.decision`。
- 2026-10-07 工程审查 verdict SHA-256：`349e790bf942ba727c1836be4aa2fa907baa75d7893c27b9cad694fbe6a767d5`；前端审查 verdict SHA-256：`035e60450f48b2921bbb00f08aedd5c1e41c2247147e07896ac1b8f189e077cd`。两份原始报告各留在独立审查 worktree，未改写。

## 已回流至本隔离树的候选

| 范围 | 集成 commit | 生成/独立评估 | 仍未满足 |
| --- | --- | --- | --- |
| R02 Git remote 三层脱敏 | `48efe92` | Generator `b7e4cef`；独立 R02 verdict `PASS`，见 `/tmp/tokenizer-r02-eval.4MEIQ7/docs/test-reports/R02-git-privacy-evaluator-verdict-2026-10-07.json` | 历史 queue/DB 备份与清理、跨版本仓库身份迁移、生产 Agent |
| FR-001/007 首次使用与历史空窗 | `b79c0b0` | Generator `f5f3718`；独立 verdict `PASS_WITH_LIMITATIONS`，见 `tokenizer-b10-first-use-eval-20261007/docs/test-reports/BL-UPGRADE-FR-FIRST-USE-evaluator-verdict-20261007.json` | 真实浏览器/首上传及离线恢复、F005 原批次验收 |
| R05/B09 可变成本缓存切片 | `106b7fd` + `0a9308a` | Generator `1925f7d` + `0ccacd8`；二轮独立 verdict `PASS_WITH_LIMITATIONS`，见 `tokenizer-cost-cache-eval-20261007/docs/test-reports/B09-usage-cost-cache-20261007/evaluator-verdict-round2.json` | B06/B08 前置、生产多实例、外部直接 DB 写入首次请求可能 stale |

本树 `npm run verify` 与 lint 通过。集成全量 `npm test`：**1479 通过、21 跳过、1 失败**，唯一失败为已知 `tests/cli/agent-lifecycle.test.ts:152` SIGTERM 锁清理竞态；B01 单独整改中，未把本次结果称作绿灯。B01/B02/B04 仍在各自隔离树推进，尚未回流。

## 发布门槛

当前没有生产部署或发布验收。B01 的 Windows、PG、契约和登录态浏览器门禁，以及 B02 安全闭环、M1-M7 余下工作、独立 F005/人闸门、备份恢复与真实生产健康检查均需后续分包完成。外部 agent 按 `AGENTS.md` 不得推送任何分支；生产发布由编排者在状态机与人闸门满足后执行，不会通过本隔离树的 commit 自动发生。
