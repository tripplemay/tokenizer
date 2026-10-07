# 升级候选集成状态（非发布验收）

## 基线与状态机边界

- 原仓 `main` 仍为 `2074991717abaf3cb34d9aad894bcd4357fefbc3`。原 worktree 预存大量 mode-only 工作区变更，本集成树未读取/覆盖这些改动；无 branch push。
- `progress.json.status=verifying`、`current_sprint=BL-HOMEPAGE-FRESHNESS`；`features.json` F005 仍 `pending`，`pending_gate=null`。当前升级修复采用独立 hotfix 候选树，**不冒充旧批次 F005 签收**，不写 `pending_gate.decision`。
- 2026-10-07 工程审查 verdict SHA-256：`349e790bf942ba727c1836be4aa2fa907baa75d7893c27b9cad694fbe6a767d5`；前端审查 verdict SHA-256：`035e60450f48b2921bbb00f08aedd5c1e41c2247147e07896ac1b8f189e077cd`。两份原始报告各留在独立审查 worktree，未改写。

## 已回流至本隔离树的候选

| 范围 | 集成 commit | 生成/独立评估 | 仍未满足 |
| --- | --- | --- | --- |
| R02 Git remote 三层脱敏 | `48efe92` | Generator `b7e4cef`；独立 R02 verdict `PASS`，见 `/tmp/tokenizer-r02-eval.4MEIQ7/docs/test-reports/R02-git-privacy-evaluator-verdict-2026-10-07.json` | 历史 queue/DB 备份与清理、跨版本仓库身份迁移、生产 Agent |
| FR-001/007 首次使用与历史空窗 | `b79c0b0` | Generator `f5f3718`；独立 verdict `PASS_WITH_LIMITATIONS`，见 `tokenizer-b10-first-use-eval-20261007/docs/test-reports/BL-UPGRADE-FR-FIRST-USE-evaluator-verdict-20261007.json` | 离线恢复、F005 原批次生产验收、B10 剩余认证闭环 |
| R05/B09 可变成本缓存切片 | `106b7fd` + `0a9308a` + replay 修正 `f225652`/`b0ac3ce` | Generator `1925f7d` + `0ccacd8`；二轮独立 verdict `PASS_WITH_LIMITATIONS`，见 `tokenizer-cost-cache-eval-20261007/docs/test-reports/B09-usage-cost-cache-20261007/evaluator-verdict-round2.json`；组合树真实 PG/Next replay 通过 | B06/B08 前置、生产多实例、外部直接 DB 写入首次请求可能 stale |
| B01 CI 基础门禁 | `6aeabce` | Generator `e599156`；二轮独立 verdict `PASS_WITH_LIMITATIONS`，见 `tokenizer-b01-ci-eval-20261007/docs/test-reports/b01-ci-foundation-20261007/evaluator-verdict-round2.json`；组合树 Node 22 clean install、PG16 迁移和 Playwright 3/3 | GitHub Actions Linux/Windows/DB/浏览器及远程契约 fixture 未在组合 SHA 上运行 |
| B02 安全依赖与认证配置 | `d8faf07` + 集成修正 `5b3a8be` | Generator `4b67b2e`；独立 verdict `PASS_WITH_LIMITATIONS` 且 `release_ready=false`，见 `tokenizer-b02-evaluator-20261007/docs/test-reports/B02-security-evaluator-20261007/verdict.json`；组合树 Node 22 clean install、verify/lint/test/build、Playwright 3/3 | 真实邮件/session/双租户 PG、剩余依赖风险人类处置、Linux Docker；公共 health 未证明 Auth.js 配置就绪 |
| B03/R06 默认采集最小化 | `0517260` + 组合 canary `dd1eb90` | Generator `1967242`；独立 round2 verdict `PASS_WITH_LIMITATIONS`，见 `/private/tmp/tokenizer-b03-eval.vFpv2h/docs/test-reports/M1-B03-R06-evaluator-round2-verdict.json`；组合树真实 Claude 源→队列→HTTP→PG→认证 API/UI 双租户 canary 通过，DB/日志敏感 canary 0 命中；全量 1515/22 skip、verify/lint/build PASS | 历史数据审批清理、限时 diagnostic opt-in、旧 Agent wire 暴露与路径型 ID 迁移；local-only backlog/scope cursor 产品语义 |

本树 `d8faf07`（B01+B02 合并后）以 Node 22 执行 `npm ci`、verify、lint、build 与全量 `npm run test` 均通过：**1500 通过、22 跳过**。组合树 scratch PG16 的 28 项迁移成功；B01 数据库 opt-in 探针 **48/48、0 skip**，锁定框架 `027c369` 的双向契约 **6/6、0 skip**。`5b3a8be` 上本地 PG16 + 生产 Next + 合成认证 Playwright 关键旅程 **3/3 通过**。第一次 B02 组合 E2E 因缺少 `AUTH_RESEND_KEY` 正确失败；补测试专用值后复测通过。B03/R06 合并后 Node 22 全量 **1515 通过、22 跳过**，verify/lint/build 通过；B04 仍在隔离树。Windows 原生 CI 仍未执行。

## 发布门槛

用户已在 2026-10-07 明确选择继续修复 B02 的 Next 内嵌 PostCSS High 与 next-intl Moderate 后再发布，**不接受本轮残留依赖风险作为放行理由**。因此 B02 独立 verdict 的 `release_ready=false` 必须保持，直到修复版依赖树、功能回归与独立复验有实物证据。

用户已确认 B03 隐私行为：`local-only` 切回 `sync` 后自动上传本机积压事件；include/exclude 规则修改只对后续采集生效，历史事件仅通过单独有界回扫。后续 UI/CLI 需显式呈现积压数量及回扫入口，不得把 `projectRoots` 当作采集白名单。

当前没有生产部署或发布验收。B01 的真实 GitHub Actions Windows/PG/契约/浏览器、B02 安全闭环、M1-M7 余下工作、独立 F005/人闸门、备份恢复与真实生产健康检查均需后续分包完成。B04 首轮独立 verdict 为 `BLOCK/NOT_READY`（未回流），并发安装、native Windows、平台服务故障与最终 release pin 均待处理。用户已指定本主会话兼任发布编排者；子 agent 仍不得推送。主会话也只会在所有发布闸门满足后考虑回流和 push-main，不会因本隔离树 commit 自动发布。
