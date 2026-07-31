---
name: project-status
description: 项目当前状态快照（覆盖写，≤30 行）— 当前批次、计划、决策、遗留问题
type: project
---
## 当前批次

- **BL-HARNESS-REPORT-COMPAT（done，4/4，fix_round 1）**：修复三个真实 `sensitive_summary_data`；人工闸门已验签消费，产品 SHA `100b147` 已部署。
- 根因 A：无 remote 项目使用 `local:<绝对路径>` repoKey，违反路径最小化契约。
- 根因 B：合法 `/v1`、`/api` route 与中文/英文斜杠分隔符被 POSIX path 正则误判。
- F001：客户端生成 `local:sha256:<digest>` opaque identity；remote 项目保持不变。
- F002：`4cc4b4f` 在 title slash 掩码前检查 forward-slash UNC，恢复 `//server/share`、`//api/x`、嵌入式 `//host/share` fail-closed。
- F003：unit + report route Prisma 前拒绝已覆盖该回归；主仓 focused 117/117、全量 53 files / 695 passed / 4 skipped，verify/lint/build 和真实 9 项目离线检查 0 failures。
- F004：fresh `reviewer-kimi-a2a` 锁定 `9974815` 于 674 秒回传 schema-valid verdict，F001-F004 全 PASS、waiting=null；focused 141/141、全量 53 files / 695 passed / 4 skipped、verify/lint/build、临时 HOME 与真实 9 项目/84 标题检查全绿。
- 人工闸门：`BL-HARNESS-REPORT-COMPAT-verifying-done-w1` 已由 `tripplezhou@gmail.com` 一次性批准，签名有效并已消费；生产发布来自随后单独明确授权。
- Generator=`builder-codex` local-cli；Evaluator=`reviewer-kimi-a2a`；family 互斥，自治关闭。
- 发布：Actions `30601984523` 的 Linux/Windows/Deploy 全绿；VPS 19 migrations 无待执行、PostgreSQL healthy、`/api/health` 回报 `100b147`。
- 本批不改 framework、Prisma、UI、i18n 或 agent feature version。

## 上一批次

- **BL-HARNESS-SYNC-HEALTH（done，6/6）**：产品 SHA `95eb927` 已部署，迁移、v5 agent 与健康心跳上线。
- Kimi A2A 全 PASS，人工闸门已验签消费；部署记录提交 `3e0240a`。

## 已知边界

- local opaque key 只保证同设备同路径稳定，不承诺无 remote 项目的跨设备关联。
- 生产九项目 `success` 需实现通过、人工闸门完成并另获显式部署授权后才能 smoke。
- Actions Node 运行时弃用、依赖 audit 与跨物理机 A2A 不并入本批。
