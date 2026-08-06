# BL-CODEX-USAGE-DEDUP Signoff 2026-08-06

> 状态：**独立验收通过**
> 触发：Codex `token_count` 累计快照被跨时间戳、跨 rollout 重复计入，导致上报用量显著偏高。

## Outcome

本批由 fresh-context Kimi evaluator 在锁定提交上完成首轮验收和 fix round 1 复验。最终 verdict 中 F001、F002、F003 全部 PASS：

- parser 使用 session high-water 计算累计正向 delta，不增长/replay/rate-limit 重发不再生成新用量；
- canonical `sourceEventId` 与文件、行号、时间戳无关，并覆盖六个 Codex 累计计数；
- server ingest 为旧 Agent 应用同一 canonical helper；
- migration 按 device + canonical snapshot 保留最早行、删除重复，并与 helper 的“六字段任一非零即有效”语义一致；
- 非 Codex、缺/非法 session、缺累计快照和全零快照不受 migration 影响。

权威验收产物：

- `docs/test-reports/BL-CODEX-USAGE-DEDUP-verdict.json`（fix round 1，F001-F003 PASS）
- `docs/test-reports/BL-CODEX-USAGE-DEDUP-round0-verdict.json`（首轮完整证据）

## Verification

| 项目 | 结果 |
|---|---|
| Parser + server 聚焦回归 | 19/19 PASS；round-0 evaluator 扩展矩阵另有 11/11 PASS |
| 当前树全量测试 | 66 files，1013 passed，4 skipped（既有 Windows-only） |
| `npm run verify` | PASS |
| `npm run lint` | 0 errors，0 warnings |
| `npm run build` | PASS |
| PostgreSQL migration fixture | 首轮 `DELETE 2 / UPDATE 4`；二次 `DELETE 0 / UPDATE 0` |
| SQL / TypeScript canonical parity | PASS，含 `total_tokens=0` 且其他累计字段非零 |
| 真实日志 metadata-only 复算 | 旧逻辑 62,473,728,807 vs v2 6,746,109,302 tokens，膨胀约 9.26x 被消除 |

## Scope

- 无 UI、定价模型或 dashboard 计算改动。
- 未 bump Agent feature version，符合纯 bug 修复策略。
- 未访问或修改生产数据库；migration 仅在 throwaway PostgreSQL 中验证。
- 未 push、未部署。部署时 migration 才会清理现有历史重复；本机 Agent 重新安装后 parser 修复才会生效。

## Soft-watch

无阻断性 soft-watch。

## Harness

本批按 `planning -> building -> verifying -> fixing -> reverifying -> done` 完成交付，`fix_rounds=1`。首次复验在完成测试后写 artifact 前命中 deadline，按规则仅重派一次聚焦复验，最终回执 `COMPLETED` 且 verdict schema-valid。

## Ops

本批次无生产或 staging 数据库 ops。
