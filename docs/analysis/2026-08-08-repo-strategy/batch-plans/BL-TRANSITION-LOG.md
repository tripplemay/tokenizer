# BL-TRANSITION-LOG 落地方案

## 目标

为 harness 控制台补上「状态流转历史」这一维度：HarnessProject 是覆盖式镜像（prisma/schema.prisma:306-346），只存当前 status，`何时 planning→building、每阶段耗时` 无从回答（roadmap P0 缺口 2）。本批次新增 `HarnessTransition` 事件表，在 report 入库事务内 diff 新旧 status/batch 追加流转行——**纯服务端 + UI 改动，agent 零改、协议零动**——并在详情页提供阶段时间线与每阶段耗时。它同时是 BL-COST-BATCH-V1（成本×阶段时间窗 join）的前置数据层。

## 范围（In / Out）

**In：**
- 新表 `HarnessTransition`（含 migration），report 路由 serializable 事务内的差分写入
- 阶段时间线口径纯函数（batch 分组、耗时计算、精度标记）
- 详情页新增第 4 个 tab `timeline`（现有 tabs 为 overview/modes/activity，app/harness/[id]/page.tsx:16）+ i18n（en/zh-CN）
- 规格文档 `docs/specs/BL-TRANSITION-LOG-spec.md`（硬性）

**Out（刻意不做）：**
- **成本归因**：UsageEvent 与阶段区间的 join、批次成本卡片——留给 BL-COST-BATCH-V1（本批次只交付它需要的时间窗数据）
- **历史批次全量归档**（HarnessProject 每批次快照化）——留给中期 BL-PERF-ANALYTICS；transition 行里已带 batch 维度，够 v1 用
- **列表页 /harness 的时间线摘要**、一次通过率等聚合指标——BL-PERF-ANALYTICS
- **transition 行的 TTL/归档策略**——量级极小（见风险 2），与 BL-PERF-ANALYTICS 的归档一并设计
- **agent 侧任何改动**（不加上报字段、不 bump 能力版本）

## Features 预案

### F001 · HarnessTransition 表 + report 差分写入 · executor: generator

涉及文件（均已实地核对）：
- `prisma/schema.prisma`（新 model + `HarnessProject`/`User` 加反向关系；harness 段在 301-457）
- `prisma/migrations/20260809000000_add_harness_transitions/migration.sql`（新增）
- `app/api/harness/report/route.ts`（事务内 585-600 附近：`existingProject` 的 select 从 `{id, userId}` 扩为 `{id, userId, status, batch, reportedAt}`；upsert 后按差分条件 `tx.harnessTransition.create`）

写入规则（勾住已知语义）：
- 仅当新 `state.status` 非 null 时才可能写行；新 status 为 null（progress.json 不可读的镜像降级）不算流转，跳过
- 无既有行或既有 status 为 null → 写「初始观测行」`fromStatus: null`
- `existing.status !== state.status || existing.batch !== state.batch` → 写一行；`observedAfter = existing.reportedAt`（区间下界），`observedAt = now`（与 `HarnessProject.reportedAt` 同一时刻值，route.ts:581）
- 同一次 report 至多一行；重复上报同状态零行（天然幂等，serializable 重试整体回滚不产生重复）

acceptance：
1. `npx vitest run tests/server/harness-report-transitions.test.ts` 全绿，覆盖：首次 report 写初始行 / status 变化写行且 from、to、fromBatch、toBatch、fixRounds、headSha、observedAfter、observedAt 字段逐一断言 / 同状态重复 report 零写入 / 新 status 为 null 跳过 / 仅 batch 变化（status 相同）也写行且 `batchBoundary=true`
2. `npx prisma migrate dev` 在本地库成功生成并应用 migration，`npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource` 无残余漂移（或等价 `migrate dev` 后 status 干净）
3. report 请求体 schema 零变化：现有 `tests/server/harness-report-mode-intent.test.ts` 全量不改仍全绿（mock 需补 `tx.harnessTransition`，属测试基建非用例改动）
4. `npm run verify` 通过

### F002 · 时间线口径纯函数 · executor: generator

涉及文件：
- `src/shared/harness-transitions.ts`（新增）：`buildTransitionTimeline(rows, {now, reportIsFresh})` → 按 batch 分组的 segments；每段耗时 = 相邻行 `observedAt` 差；当前进行中阶段耗时 = `now − 最后一行 observedAt`，仅 `reportIsFresh` 时给出（复用 `src/shared/device-status.ts:51-62` 的判定，20 分钟窗口）；`observedAt − observedAfter` 超阈值（建议 10 分钟）的行标 `lowPrecision`；`batchBoundary` 行切断耗时聚合

acceptance：
1. `npx vitest run tests/shared/harness-transitions.test.ts` 全绿，覆盖：batch 分组正确 / fixing⟷reverifying 多轮循环按 fixRounds 区分且各轮耗时独立成段 / 跨批次边界不合并耗时 / 初始观测行（fromStatus=null）只作起点不计耗时 / lowPrecision 标记 / 进行中阶段仅在 fresh 时有耗时
2. 函数为纯函数：不 import prisma / next / react（`grep -L` 可机械验证）
3. 压缩边（如 building→fixing 这类非法定相邻流转）不抛错、原样呈现并可标注

### F003 · 详情页 timeline tab + i18n · executor: generator

涉及文件：
- `src/server/harness-detail.ts`（`ownedHarnessProjectDetailQuery` 增加 `transitions` 关系子查询：`where {userId}`、`orderBy observedAt desc`、`take 100`，字段白名单 select——与 gates/modeIntents/dispatchRuns 同风格，3-107）
- `app/harness/[id]/page.tsx`（VIEWS 加 `"timeline"`，16-22；icons 映射加一项，42-46）
- `app/harness/[id]/views.tsx`（新增 `TimelineView`：按 batch 分组的垂直时间线，样式可仿 ActivityView 的 modeIntents 时间线 550-579；每 batch 段尾放阶段耗时小结；lowPrecision 行给徽章；页首放一段固定的精度口径说明文案）
- `messages/en.json`、`messages/zh-CN.json`（`harness.detail.tabs.timeline` + 新 `harness.timeline.*` 命名空间；zh-CN 的 tabs 现为 overview/modes/activity 三键，已核）

acceptance：
1. `npx vitest run tests/shared/harness-detail.test.ts tests/server/harness-detail.test.ts` 全绿，后者新增断言：`query.select.transitions.where = {userId}`、`take = 100`
2. `npm run lint && npm run verify` 通过
3. 本地起 dev（`npm run dev` + seed 一个含 ≥2 条 transition 的 HarnessProject），`/harness/[id]?view=timeline` 渲染分组时间线、from→to 标签、耗时与精度徽章；无 transition 行时显示空占位（UI 断言可由 evaluator 实测截图/DOM 检查）
4. 时间渲染走既有 `formatDateTimeSeconds(_, timezone)`（views.tsx:26 已 import），遵守用户时区偏好；存储值全 UTC

## 数据模型 / migration

新表（additive，不动任何既有表结构；`HarnessProject`/`User` 仅加反向关系字段，不产生列变更）：

```prisma
model HarnessTransition {
  id               String    @id @default(cuid())
  userId           String
  harnessProjectId String
  /// null = 该 project 的首次观测行（部署后第一次 report，或镜像从降级恢复）
  fromStatus       String?
  toStatus         String
  fromBatch        String?
  toBatch          String?
  /// fromBatch != toBatch：跨批次边界，耗时统计不得跨此行聚合
  batchBoundary    Boolean   @default(false)
  /// 观测时刻的 fixRounds 快照——区分同批次内第几轮 fixing⟷reverifying 循环
  fixRounds        Int       @default(0)
  headSha          String?
  /// 上一次成功上报的 reportedAt（区间下界，exclusive）；null = 首次观测
  observedAfter    DateTime?
  /// 本次上报服务端接收时刻（区间上界，inclusive）；真实流转发生在 (observedAfter, observedAt]
  observedAt       DateTime
  createdAt        DateTime  @default(now())

  user           User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  harnessProject HarnessProject @relation(fields: [harnessProjectId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([harnessProjectId, observedAt])
  @@index([toBatch])
}
```

- `@@index([toBatch])` 是给 BL-COST-BATCH-V1 按批次拉时间窗用的
- **无法回填历史**：镜像只存当前态，上线前的流转已丢失；每个项目部署后的下一次 report 落一行 `fromStatus: null` 初始观测行作为时间线起点
- **精度口径（必须原文写进 spec 与 UI 说明）**：上报是 60s 轮询镜像（`src/cli/agent.ts` 的 HARNESS_MS 节拍，reader-console.md §2），agent 在线时流转时刻误差 ≤ 一个轮询周期量级；轮询间隔内穿越多个阶段会被压缩成一条「非相邻边」（如 building→fixing，中间的 verifying 永久丢失）；agent 离线（休眠/关机）期间误差无上界。本表是**镜像差分观测日志**，权威真相仍是各仓 progress.json 的 git 历史（schema.prisma:301-304 的镜像定位不变）

## API 与协议影响

- **无新增/修改 endpoint**。改动全部在 `POST /api/harness/report` 的服务端事务内部（route.ts:495-721），请求体 schema、响应体、错误码零变化；`GET`（route.ts:735+）返回的 project 行不含关系字段，不受影响
- **agent 零改，AGENT_FEATURE_VERSION（=9）与 MIN_AGENT_FEATURE_VERSION（=9，src/shared/agent-feature-version.ts:50-51）均不 bump**：没有任何新能力要求 agent 升级，旧 agent 的 report 原样产生 transition 行。符合「尽量不动 agent↔服务端协议」总原则
- **部署触发说明**：本批次改 `prisma/**`、`app/**`、`src/**`、`messages/**`、`tests/**`——全部**不在** deploy-vps.yml 的 paths-ignore 内，**push main 即部署生产**。migration 为纯新增表，零停机；部署链路中 `migrate` job 跑 `prisma migrate deploy`（docs/VPS-deployment.md:47）。建议整批实现完成、verify 全绿后一次 push，避免多次触发部署

## 测试计划

| 文件 | 新/改 | 关键用例 |
|---|---|---|
| `tests/server/harness-report-transitions.test.ts` | 新 | 首次 report 初始行 / status 变化写行（全字段断言）/ 同状态零写入 / status null 跳过 / 仅 batch 变化写行且 batchBoundary=true / fixing⟷reverifying 两轮产生 4 行且 fixRounds 递增。mock 风格照抄 `harness-report-mode-intent.test.ts` 的 `vi.hoisted` tx mock |
| `tests/shared/harness-transitions.test.ts` | 新 | batch 分组 / 耗时=相邻 observedAt 差 / 进行中阶段仅 fresh 计时 / lowPrecision 阈值 / 初始行不计耗时 / 压缩边容忍 |
| `tests/server/harness-detail.test.ts` | 改 | transitions 子查询的 userId 过滤与 take=100 上限（沿既有两个用例的断言模式） |
| `tests/server/harness-report-mode-intent.test.ts` | 改（基建） | 仅给 tx mock 补 `harnessTransition.create`，既有断言不动 |

回归：`npm run test`（全量 vitest）+ `npm run lint` + `npm run verify`。

## 依赖与前置

- **前置：无**（不依赖任何未完成批次；所需数据 report 链路今天已在上报）
- **被依赖：BL-COST-BATCH-V1（强依赖）**——时间窗 join 的窗口即本表的 `(observedAt_i, observedAt_{i+1}]` 序列 + `toBatch` 维度；roadmap 明示本批次是其前置
- **同期批次协调：BL-GATE-INBOX 的 evidence 内容上传切入点也在 `app/api/harness/report/route.ts`（parseGate，341-378）**。两批次改同一文件不同区段，可并行但需注意合并次序；若编排上串行，建议本批次先行（更小、无 UI 争议）
- BL-PERF-ANALYTICS（中期）将直接消费本表做返工轮数/阶段耗时聚合

## 风险与对策

1. **serializable 事务内新增一次写，扩大冲突/重试面** → 写入是单行 insert 且在既有 `retrySerializableTransaction`（route.ts:495）保护内；对策：diff 判定所需字段并入既有 `existingProject` 查询（585-588），不加额外读
2. **表无限增长** → 量级实测口径：每项目每批次约 6-12 行（七阶段 + fix 循环），本机 9 个消费者项目下年增千行级，可忽略；TTL/归档刻意 Out，留 BL-PERF-ANALYTICS
3. **耗时被误读为精确值**（60s 轮询 + 离线间隙 + 压缩边） → 口径三处落地：spec 文档、UI 固定说明文案、lowPrecision 徽章；BL-COST-BATCH-V1 的 spec 须继承同一口径
4. **首次上线后的初始观测行污染统计** → `fromStatus: null` 行在 F002 中显式定义为「起点不计耗时」，测试锁定
5. **legacy repoKey 身份迁移路径**（route.ts:198-266 的 reconcile 会 re-key 旧 project）→ transition 挂在 harnessProjectId 上，re-key 保留同一父 id，历史行自然跟随；migration 后首个 report 若恰逢 reconcile，最坏情况多一行初始观测行，无正确性影响（此边界建议 evaluator 验收时人工推演一次，标注：未核实测）
6. **push 即部署** → 见协议节：单次 push 交付全批次；migration additive 可安全回滚（drop table 即可，无数据耦合）

## 规模估计

**S+**（偏小的中等）·  **3 个 feature** · 主要涉及文件 **约 11 个**（schema + migration + report route + harness-detail.ts + page.tsx + views.tsx + 2 个 messages + 1 个新 shared 模块 + 2 个新测试文件；另有 2 个既有测试文件小改、1 份 spec 文档）。单会话快车道一批可完成；无并行 worktree 必要。