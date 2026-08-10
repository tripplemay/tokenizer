# BL-COST-BATCH-V1 规格 —— 成本×批次/阶段归因 v1（+1 顺路项）

- **批次目标：** 把「这个批次/这个阶段烧了多少钱」变成控制台一等公民视图——用 HarnessTransition 的阶段流转时间戳对 UsageEvent.occurredAt 做时间窗 join。战略路线图判定的「全场空白差异点」（成本×编排同库同租户）第一次兑现。顺路：prisma migrations 卫生项。
- **详细预案：** `docs/analysis/2026-08-08-repo-strategy/batch-plans/BL-COST-BATCH-V1.md`（F001–F004 的设计要点、风险对策以预案为准；本文件记录契约适配决策与 F005）
- **执行形态：** 快车道默认映射（resolver `{}`）；混合批次（3 generator + 1 evaluator）→ building → verifying
- **硬约束：** 零协议改动 · agent `src/cli/**` 一字不动 · `AGENT_FEATURE_VERSION` 9/9 不动 · F001–F003/F005 push 即部署（独立 commit 单 revert）· 新逻辑全部进独立 `src/server/harness-cost.ts`，不动 1128 行的 summaries.ts

## 契约适配决策（预案写作时 HarnessTransition 尚不存在，现按实际表形状钉死）

实际表（schema.prisma:356-383）比预案最小契约富：

| 预案假设 | 实际形状 | 适配决策 |
|---|---|---|
| `batch String` 单列 | `fromBatch`/`toBatch` + `batchBoundary` + `fixRounds` 快照 | 窗口按 **`toBatch`** 归属批次；`batchBoundary=true` 行为跨批次切点，耗时/成本聚合不得跨该行 |
| `occurredAt DateTime` 点时间 | `observedAfter`（exclusive 下界）/`observedAt`（inclusive 上界）区间语义 | 切点取 **`observedAt`**；真实流转发生在 (observedAfter, observedAt] 内，镜像延迟即误差上界——BL-AGENT-LATENCY 已把该延迟压到 ≤2min（daemon 60s / cron 2min），在精度声明中如实标注 |
| `@@index([harnessProjectId, occurredAt])` | `@@index([harnessProjectId, observedAt])` | 直接可用 |
| `fromStatus String` | `fromStatus String?`（null = 首次观测行） | 首次观测行作为区间起点处理，不产生「未知阶段」区间 |

F004 数据面前提已满足：TRANSITION-LOG 上线后已积累 BL-GATE-INBOX、BL-AGENT-LATENCY 两个完整批次的真实 transitions。

## Features 与 acceptance

### F001 · 阶段区间构建 + 时间窗成本聚合层 · executor: generator
按预案 §F001 + 上表适配。`buildPhaseIntervals(transitions, now)` 纯函数（无 DB 依赖）；`getBatchCost` 逐区间 groupBy + estimateCost 复用 summaries.ts:48-96 既有口径；区间上限 60 超出合并最旧；`unstable_cache` 30s + MODEL_PRICES_CACHE_TAG。
acceptance：预案 5 条（空 transitions/开区间/多轮 fixing⟷reverifying/跨批次切窗/上限合并；纯函数不 mock prisma；costUsd 与手工 estimateCost ±1e-8；UTC 跨日界 fixture 开闭沿；verify+test 全量）+ 适配断言：batchBoundary 行切窗、observedAt 作切点、fromStatus null 首行不产生未知区间。

### F002 · /harness/[id] overview 批次成本卡片 · executor: generator
按预案 §F002。总成本 + compute tokens · 按阶段行（阶段/起止/耗时/成本）· 返工小计 · 精度声明（i18n `harness.detail.cost.*`）。
acceptance：预案 5 条（build 过 + 卡片三元素 / i18n 双语含精度声明 / 无 transitions 空态 / 双关联失败不触 DB / 取数钉在 overview 分支）。

### F003 · /projects/[id] 批次成本联动卡片 · executor: generator
按预案 §F003。关联 harness 批次列表（batch/status/成本/链接），与 F002 共用同一缓存导出，同口径同值。
acceptance：预案 4 条。

### F004 · 归因精度实测审计报告 · executor: evaluator
按预案 §F004，报告落 `docs/test-reports/BL-COST-BATCH-V1-attribution-audit-2026-08-10.md`。
acceptance：预案 5 条（阶段和=批次总 ±$0.01 / 混入误差「只多不算少」实证并量化 / 边界秒归属与实现开闭沿一致 / 文案与实测相符 / 报告入库）。

### F005 · prisma migrations 卫生 · executor: generator（顺路，源 BL-MIGRATION-LOCK-DRIFT）
① 补 `prisma/migrations/migration_lock.toml`（provider = "postgresql"）；② `npx prisma migrate diff --from-migrations --to-schema-datamodel` 机械量化 legacy 漂移；③ 漂移为空 → 记录零漂移证据；非空且可安全收敛 → 生成**纯 additive** 修正 migration（scratch 库重放验证）；非 additive 可收敛 → 不动库，把漂移清单与裁决记录写进 commit 与 spec 附注，回 backlog 立独立批次。
acceptance：
1. migration_lock.toml 入库且 `npx prisma migrate deploy` 在 scratch 库全链干净（实跑证据）
2. migrate diff 输出全文记录在 commit 正文或 `docs/test-reports/`（机械依据，铁律 13）
3. 若产生修正 migration：scratch 重放 + 全量 test 绿；若不产生：漂移裁决记录在案
4. `npm run verify` + 全量 test 绿

## 关键决策记录

- **窗口归属 toBatch + observedAt 切点**（见适配表）——v2 精确归因（agent 报 batch id）落地时只换数据源不换 UI。
- **误差方向恒「只多不少」**：时间窗是超集；三类混入（同项目同时段人工用量 / 多设备同 repoKey / 非 git 项目关联不通）在精度声明与 F004 报告如实列出。
- **F005 走「先量化再裁决」**：漂移未知，不预设修法；非 additive 情况宁可回 backlog 也不在顺路项里动库。
- **push 节奏**：F001（纯新增文件，UI 零变化）→ F002 → F003 → F005 各自独立 commit；F004 报告不触发部署。

## 测试计划

预案 §测试计划不变（基线已从 1013 涨到 1127）；追加 F005 的 scratch 重放证据。
