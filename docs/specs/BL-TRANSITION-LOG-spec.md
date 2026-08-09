# BL-TRANSITION-LOG — 状态流转事件表 + 批次归档表 + 详情页 timeline tab

> 状态：planning 定稿 · 2026-08-09 · Planner=主会话（快车道默认映射，无 active mode intent）
> 详细依据：`docs/analysis/2026-08-08-repo-strategy/batch-plans/BL-TRANSITION-LOG.md` +
> `batch-plans/BL-PERF-ANALYTICS.md` F001 节（归档表按落地计划建议吸收进本批，用户 2026-08-09 确认启动）
> 执行序：落地计划近期 #2；是 BL-COST-BATCH-V1（成本归因）的硬前置数据层。

## 1. 目标

HarnessProject 是覆盖式镜像，只存当前 status——「何时 planning→building、每阶段耗时、历史批次」无从回答。
本批次交付两张事实表 + 一个呈现面，**纯服务端 + UI 改动，agent 零改、协议零动、AGENT_FEATURE_VERSION 不 bump**：

1. `HarnessTransition` 流转事件表：report 入库事务内 diff 新旧 status/batch 追加
2. `HarnessBatchArchive` 批次归档表：入 done upsert / 批次切换 superseded 保底（吸收自 BL-PERF-ANALYTICS F001——归档晚上线一天 = 一天批次历史永久丢失）
3. 详情页第 4 个 tab `timeline`：按批次分组的阶段时间线 + 耗时 + 精度标记

## 2. Features（全部 executor:generator，普通批次）

### F001 · HarnessTransition 表 + report 差分写入
- schema（`prisma/schema.prisma` harness 段）：`id/userId/harnessProjectId(FK Cascade)/fromStatus?/toStatus/fromBatch?/toBatch?/batchBoundary(default false)/fixRounds(default 0)/headSha?/observedAfter?/observedAt/createdAt`；索引 `[userId]`、`[harnessProjectId, observedAt]`、`[toBatch]`（给 COST 按批次拉窗用）。
- 写入规则（`app/api/harness/report/route.ts` serializable 事务内，`existingProject` select 扩出 status/batch/reportedAt）：新 status 为 null 跳过；无既有行或既有 status null → 初始观测行 `fromStatus:null`；`status` 或 `batch` 变化 → 写一行，`observedAfter=existing.reportedAt`（区间下界）、`observedAt=now`（与 HarnessProject.reportedAt 同刻）；仅 batch 变化也写行且 `batchBoundary=true`；同状态重复上报零写入（幂等）。
- **契约冻结（BL-COST-BATCH-V1 消费面）**：COST 方案里的 `batch`↔本表 `toBatch`、`occurredAt`↔本表 `observedAt`；`@@index([toBatch])` 已含。此映射写死于此，COST spec 引用本节。
- acceptance：新增 `tests/server/harness-report-transitions.test.ts` 全绿（首次 report 初始行 / status 变化全字段断言 / 同状态零写入 / status null 跳过 / 仅 batch 变化 batchBoundary=true / fixing⟷reverifying 两轮 4 行 fixRounds 递增；mock 风格仿 `harness-report-mode-intent.test.ts` 的 vi.hoisted tx mock）；`npx prisma migrate dev` 干净；report 请求/响应契约零变化（既有测试仅补 tx mock 不改断言）；`npm run verify` 过。

### F004 · HarnessBatchArchive 归档表 + done/superseded 触发（吸收自 BL-PERF-ANALYTICS）
- schema：`id/userId/harnessProjectId(FK Cascade)/repoKey/batch/status/fixRounds/completedCount/totalCount/headSha?/signoff?/dashboardUrl?/features Json/firstPass Boolean/archivedReason("done"|"superseded")/doneAt?/reportedAt/createdAt/updatedAt`；`@@unique([harnessProjectId, batch])`、`@@index([userId])`、`@@index([doneAt])`。
- 触发（同一 report 事务）：incoming `status=="done"` 且 batch 非空 → upsert（尾部上报刷新 signoff/features/reportedAt 白名单字段；`doneAt`/`firstPass` 仅 create 写入不被 refresh 改写）；旧行 batch 非空、新 batch ≠ 旧 batch、旧 status≠done → 用旧行值落 `archivedReason:"superseded"`（中断批次入史，不算通过）。
- acceptance：新增 `tests/server/harness-batch-archive.test.ts` 全绿（building→done 建档 firstPass=fixRounds==0 / 同 batch 二次 done 上报行数仍 1 且 doneAt 不变 signoff 刷新 / verifying 中换 batch 产生 superseded 快照 / 跨用户隔离）；migration 与 F001 可同文件或分列，均纯 additive。

### F002 · 时间线口径纯函数
- 新增 `src/shared/harness-transitions.ts`：`buildTransitionTimeline(rows, {now, reportIsFresh})` → 按 batch 分组 segments；耗时=相邻 `observedAt` 差；进行中阶段仅 `reportIsFresh`（复用 `device-status.ts` 20 分钟窗口判定）时计 `now−末行`；`observedAt−observedAfter` > 10 分钟标 `lowPrecision`；`batchBoundary` 行切断聚合；初始行（fromStatus null）只作起点不计耗时；非法定相邻边（压缩边）不抛错、原样呈现可标注。
- acceptance：`tests/shared/harness-transitions.test.ts` 全绿覆盖上述全部口径；纯函数（不 import prisma/next/react，grep 断言）。

### F003 · 详情页 timeline tab + i18n
- `src/server/harness-detail.ts` 增 `transitions` 子查询（userId 过滤、`orderBy observedAt desc`、take 100、字段白名单——与 gates 同风格）；`app/harness/[id]/page.tsx` VIEWS 加 `"timeline"` + icon；`views.tsx` 新增 `TimelineView`（按 batch 分组垂直时间线，样式仿 ActivityView 的 intents 时间线；每 batch 段尾阶段耗时小结；lowPrecision 徽章；页首固定精度口径说明）；`messages/en.json` + `zh-CN.json`（tabs.timeline + harness.timeline.* 命名空间）。
- 时间渲染走既有 `formatDateTimeSeconds(_, timezone)`；存储值全 UTC。
- acceptance：`harness-detail` 测试补断言（transitions 子查询 userId 过滤 + take 100）；`npm run lint`/`verify` 过；本地 dev 对 seed 数据渲染分组时间线/耗时/精度徽章、无数据空占位（UI 断言归 Evaluator）；en/zh 键集一致。

## 3. 精度口径（必须原文出现在 spec、UI 说明、COST spec 三处）

上报是 60s 轮询镜像：agent 在线时流转时刻误差 ≤ 一个轮询周期量级；轮询间隔内穿越多个阶段会被压缩成一条非相邻边（中间态永久丢失）；agent 离线期间误差无上界。两张表是**镜像差分观测日志**，权威真相仍是各仓 progress.json 的 git 历史。

## 4. 编排与边界

- 快车道默认映射：主上下文 Generator 串行实现（F001→F004 同改 report route 事务，先后紧邻；F002 独立；F003 最后）；每 feature 独立 commit；Evaluator = 隔离 subagent（fresh context）在 verifying 阶段验收。
- **部署触发**：本批改 `prisma/** app/** src/** messages/** tests/**`——push 即部署。整批实现完、verify 全绿后一次 push（migration 纯新增表，零停机）。
- Out（刻意不做，防 scope 蔓延）：成本 join（BL-COST-BATCH-V1）· 聚合分析页与一次通过率（BL-PERF-ANALYTICS）· 列表页时间线摘要 · transition/archive 的 TTL 策略 · agent 侧任何改动。
- 风险对策沿 batch-plans 原文：serializable 冲突面（diff 字段并入既有 select 不加额外读）；表增长（每项目每批次 6-12 行，忽略）；legacy repoKey reconcile（行挂 harnessProjectId，re-key 自然跟随——Evaluator 验收时人工推演一次）。
