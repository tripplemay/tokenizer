---
name: project-status
description: 项目当前状态快照（覆盖写，≤30 行）— 当前批次、计划、决策、遗留问题
type: project
---
## 当前批次

- **BL-HARNESS-REPORT-COMPAT（building，0/4，fix_round 0）**：修复三个真实 `sensitive_summary_data`。
- 根因 A：无 remote 项目使用 `local:<绝对路径>` repoKey，违反路径最小化契约。
- 根因 B：合法 `/v1`、`/api` route 与中文/英文斜杠分隔符被 POSIX path 正则误判。
- F001：客户端生成 `local:sha256:<digest>` opaque identity；remote 项目保持不变。
- F002：仅为 `feature.title` 精确允许安全 route 与词内分隔符，路径/凭据/raw channel 仍 fail-closed。
- F003：用三个真实失败形状补客户端、服务端和泄漏回归；全量 L1/build。
- F004：`reviewer-kimi-a2a` fresh-context 独立验收。
- Generator=`builder-codex` local-cli；Evaluator=`reviewer-kimi-a2a`；family 互斥，自治关闭。
- 本批不改 framework、Prisma、UI、i18n 或 agent feature version，不 push/deploy。

## 上一批次

- **BL-HARNESS-SYNC-HEALTH（done，6/6）**：产品 SHA `95eb927` 已部署，迁移、v5 agent 与健康心跳上线。
- Kimi A2A 全 PASS，人工闸门已验签消费；部署记录提交 `3e0240a`。

## 已知边界

- local opaque key 只保证同设备同路径稳定，不承诺无 remote 项目的跨设备关联。
- 生产九项目 `success` 需实现通过、人工闸门完成并另获显式部署授权后才能 smoke。
- Actions Node 运行时弃用、依赖 audit 与跨物理机 A2A 不并入本批。
