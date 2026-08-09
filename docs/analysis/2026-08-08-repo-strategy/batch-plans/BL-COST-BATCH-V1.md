# BL-COST-BATCH-V1 落地方案

> 规划前提核对：本方案所有文件路径均已实地打开核对（2026-08-09，工作树 clean @ afa0297）。唯一未核对物是 `HarnessTransition` 表——它由前置批次 BL-TRANSITION-LOG 产出，当前 schema.prisma 与 src/ 中零命中（已 grep 确认不存在），本方案以「依赖契约」形式显式声明其最小形状。

## 目标

把「这个批次/这个阶段烧了多少钱」变成控制台一等公民视图——用 BL-TRANSITION-LOG 落库的阶段流转时间戳，对 `UsageEvent.occurredAt` 做时间窗 join，在 `/harness/[id]` overview 呈现批次成本卡片，在 `/projects/[id]` 呈现批次成本联动。**零采集端改动、零协议改动、零新表**——这是战略路线图判定的「全场空白差异点」（成本×编排同库同租户，`HarnessProject.projectId → Project` 外键已在 schema.prisma:313,338）的第一次兑现。

## 范围（In / Out）

**In：**
- 服务端归因聚合层（新文件，不再往 1128 行的 `src/server/summaries.ts` 里加）
- `/harness/[id]` overview tab 批次成本卡片（批次总成本 / compute tokens / 按阶段分解 / 返工小计）
- `/projects/[id]` 联动卡片（该用量项目关联的 harness 批次成本列表 + 跳转）
- 归因精度边界的如实 UI 声明 + evaluator 实测审计报告

**Out（刻意不做）：**
- **不动采集端**：agent report 不加 batch id / feature id 维度——那是 v2（远期批次，精确归因），本批次接受时间窗混入误差并如实标注
- **不加 UsageEvent 新列、不建新表**：`HarnessTransition` 属 BL-TRANSITION-LOG 的交付物
- **不做预算/告警**：留给 BL-BUDGET（它可复用本批次的成本聚合函数）
- **不做 per-feature 成本、一次通过率等质量指标合流**：留给中期 BL-PERF-ANALYTICS
- **不做历史批次归档视图**：HarnessProject 只存当前批次是既有事实（roadmap.md §2.2 #11），本批次只归因「transitions 覆盖到的窗口」，不解决批次历史入库

## Features 预案

### F001 · 阶段区间构建 + 时间窗成本聚合层 · executor: generator

**涉及文件：**
- 新增 `src/server/harness-cost.ts`（核心交付物）
- 新增 `tests/server/harness-cost.test.ts`
- 参照物（只读不改）：`src/server/summaries.ts:48-96`（billable 口径 + `costForWhere`/`computeAndCostFor` 模式）、`summaries.ts:1121-1128`（`unstable_cache` 30s + `MODEL_PRICES_CACHE_TAG` 包装模式）、`src/server/model-prices.ts`（`getEffectivePrices`）

**设计要点：**
- 纯函数 `buildPhaseIntervals(transitions, now)`：把 HarnessTransition 序列折成 `[{phase, batch, start, end|null}]`，当前阶段为开区间（end = now）；批次边界以 transition 的 `batch` 列切分；区间数上限 60（超出合并最旧），防 fix 轮爆炸
- `getBatchCost(userId, {projectId, repoKey}, intervals)`：逐区间 `prisma.usageEvent.groupBy({ by: ["model"], where: { userId, projectId, occurredAt: { gte, lt } }, _sum: {...} })` + `estimateCost`（完全复用 summaries.ts:61-96 的既有口径）；`projectId` 为 null 时回退用 `repoKey` 过滤（`@@index([repoKey])` 已在 schema.prisma:223）；两者皆 null 返回 null
- 导出用 `unstable_cache` 30s + `MODEL_PRICES_CACHE_TAG` 包装，与 summaries.ts:1121-1128 同款

**acceptance：**
1. `npx vitest run tests/server/harness-cost.test.ts` 全绿，用例必须覆盖：空 transitions、当前阶段开区间、fixing⟷reverifying 多轮、跨批次边界切窗、区间上限合并
2. `buildPhaseIntervals` 为无 DB 依赖纯函数导出，其测试用例不 mock prisma 即可运行
3. 成本口径断言：固定 fixture 下 `getBatchCost` 的 costUsd 与手工 `estimateCost` 结果一致（±1e-8）；compute 口径 = `max(0, input − cached) + output`，与 summaries.ts:48-51 逐字一致
4. 时间断言：所有区间比较基于 UTC `Date`，测试含一个跨日界 fixture（occurredAt 落在区间开闭沿）
5. `npm run verify` 与 `npm run test` 全量通过

### F002 · /harness/[id] overview 批次成本卡片 · executor: generator

**涉及文件：**
- `app/harness/[id]/page.tsx`（105 行；在 `view === "overview"` 分支并行取数传入）
- `app/harness/[id]/views.tsx`（667 行；`OverviewView`（:72 起）新增「批次成本」section，位于 identity section 之后）
- `messages/en.json`、`messages/zh-CN.json`（`harness.detail.cost.*` 键组）
- 取数所需字段已在 `src/server/harness-detail.ts` select 内（`project.project.id` :37、`repoKey` :9、自身 `id` :7）——**该文件无需改动**
- 复用 `src/shared/format.ts:78`（`formatUsd`）

**卡片内容：** 批次总成本 + compute tokens · 按阶段行（阶段名 / 起止 / 耗时 / 成本）· 返工小计（fixing+reverifying 各轮合计）· 固定精度声明文案

**acceptance：**
1. `npm run build` 通过；overview tab 渲染批次成本卡片，含总成本、按阶段行、返工小计三个元素（UI 断言：本地 `npm run dev` 对一个有 transitions 的项目截图核对）
2. `grep -c '"cost"' messages/en.json messages/zh-CN.json` 双文件命中新键组；en/zh 均含精度声明文案（含义为「同项目同时段的非本批次用量会计入，v2 精确归因」）
3. 无 HarnessTransition 记录时渲染空态文案（i18n 键）而非报错/空白（UI 断言）
4. `projectId` 与 `repoKey` 关联双双失败时卡片显示「未关联用量项目」提示且不发起 usageEvent 查询（代码审查 + `harness-cost.test.ts` 断言 null 输入不触 DB）
5. `view !== "overview"` 时不执行成本取数（代码审查断言：取数在 page.tsx 的 overview 条件分支内）

### F003 · /projects/[id] 批次成本联动卡片 · executor: generator

**涉及文件：**
- `app/projects/[id]/page.tsx`（177 行；在 Sources/Models 卡片区（:83-144）后新增卡片）
- `messages/en.json`、`messages/zh-CN.json`（`project.harnessCost.*` 键组）
- 查询：`prisma.harnessProject.findMany({ where: { projectId: id, userId } })`（外键 schema.prisma:313）+ F001 的 `getBatchCost`

**卡片内容：** 该用量项目关联的 harness 项目列表——batch 名 / status / 当前批次成本 / 链到 `/harness/{harnessProject.id}`

**acceptance：**
1. 关联了 harnessProject 的项目详情页渲染「编排批次成本」卡片，行内成本值与 `/harness/[id]` overview 卡片同口径同值（UI 断言，同一 30s 缓存窗口内比对）
2. 无关联 harnessProject 时整个卡片不渲染（非空卡片；UI 断言 + 代码审查）
3. 行链接 href 为 `/harness/{id}` 且可达（UI 断言）
4. `npm run verify`、`npm run build`、`npm run test` 全量通过

### F004 · 归因精度实测审计报告 · executor: evaluator

**涉及文件（只写报告，不改产品代码）：**
- 新增 `docs/test-reports/BL-COST-BATCH-V1-attribution-audit-{date}.md`

**acceptance：**
1. 用本机真实库（或 fixture 库）对 ≥1 个有完整 transitions 的批次实测：各阶段成本之和 = 批次总成本（±$0.01）；批次窗口成本 ≤ 项目全量成本
2. 构造混入场景（批次窗口内插入非批次 UsageEvent）实证误差方向为「只多算不少算」，报告记录误差比例
3. 验证 UTC 正确性：构造一条恰在阶段边界秒的事件，确认落入正确区间（gte/lt 开闭沿与 F001 实现一致）
4. 核对 F002/F003 的精度声明文案与实测误差表现相符，不夸大不缩小
5. 报告按 harness 验收模板落盘并 commit（`docs/test-reports/**` 在 paths-ignore 内，不触发部署）

## 数据模型 / migration

**无。** 本批次不建表、不加列、无 migration（当前 migrations 尾项为 `20260806000000_canonicalize_codex_usage_events`，本批次不新增）。

**依赖的外部契约（BL-TRANSITION-LOG 交付，本批次消费）——最小形状要求：**

```
HarnessTransition {
  id, userId, harnessProjectId → HarnessProject(Cascade),
  batch String,            ← 硬性：无此列则多批次连跑时窗口无法切分
  fromStatus, toStatus String,
  occurredAt DateTime      ← UTC，来源为 report 端 diff 时刻或 progress.json 时间戳
  @@index([harnessProjectId, occurredAt])
}
```

此契约须在 BL-TRANSITION-LOG 的 spec 评审时冻结（尤其 `batch` 列与索引），本批次 spec 引用之。**（未核：该表尚不存在，以上为本批次对前置批次的输入要求，非既成事实。）**

## API 与协议影响

- **新增/修改 endpoint：无。** 全部取数走 Next.js 服务端组件直查（`app/harness/[id]/page.tsx`、`app/projects/[id]/page.tsx` 均已是 `force-dynamic` 服务端页面），不新增 `/api/*` 路由
- **agent↔服务端协议：零改动。** `src/cli/**` 一个字符不动；report 载荷、heartbeat、decisions/relay 通道均不变
- **AGENT_FEATURE_VERSION：不 bump。** 当前 `AGENT_FEATURE_VERSION = 9 / MIN_AGENT_FEATURE_VERSION = 9`（src/shared/agent-feature-version.ts:50-51）保持不变——本批次无任何「要求 agent 升级的新能力」，纯服务端读路径
- **部署触发：会。** 本批次改 `app/**`、`src/server/**`、`messages/**`、`tests/**`——全部不在 deploy-vps.yml paths-ignore 清单内（已核对 :9-28），**F001-F003 每次 push main 都会部署生产**。因此三个 generator feature 必须各自独立 commit 且 commit 时点可运行（铁律 5）；无 migration、无 env 变更，任何一步的回滚 = `git revert` 单 commit。spec 与 F004 报告（`docs/specs/**`、`docs/test-reports/**`）在 paths-ignore 内，不触发部署

## 测试计划

| 文件 | 新/改 | 关键用例 |
|---|---|---|
| `tests/server/harness-cost.test.ts` | 新增 | 区间构建：空 transitions / 开区间 / 多轮 fixing⟷reverifying / 跨批次切窗 / 区间上限合并；成本：fixture 口径与 estimateCost 一致、null 关联键不触 DB、UTC 边界沿 |
| `docs/test-reports/BL-COST-BATCH-V1-attribution-audit-*.md` | 新增（F004） | 阶段和=批次总、混入误差方向、边界秒归属、文案相符性 |
| 既有全量 | 回归 | `npm run test`（当前基线 1013 tests，见 progress.json session_notes）+ `npm run verify` 全绿 |

说明：本项目 `app/` 页面现状零 UI/E2E 测试（reader-usage.md 短板 2），本批次不引入 E2E 框架——UI acceptance 以「build 通过 + i18n 键存在 + 本地 dev 实测断言」三件套机械化，与项目既有验收惯例一致。

## 依赖与前置

**依赖（先行）：**
- **BL-TRANSITION-LOG（硬依赖）**：`HarnessTransition` 表 + report 路由 diff 写入（写入点在 `app/api/harness/report/route.ts:593-597` 的 upsert 前后 diff 新旧 status）。没有它本批次无窗口可 join。且其 spec 必须含 `batch` 列（见上文契约）
- BL-GATE-INBOX：无依赖关系，可并行

**被依赖（后续）：**
- **BL-BUDGET**：可直接复用 `harness-cost.ts` 的聚合函数做批次级预算对照
- **BL-PERF-ANALYTICS（中期）**：「每 feature 成本 / 成本×质量」页以本批次为地基
- **v2 精确归因（远期）**：agent report 加 batch id 后，本批次的 UI 卡片不换、只换数据源精度——这是本方案把聚合层独立成文件的原因

## 风险与对策

| # | 风险 | 对策 |
|---|---|---|
| 1 | **HarnessTransition 契约未冻结**：若 BL-TRANSITION-LOG 未落 `batch` 列，多批次连跑会串窗 | 本方案把最小契约写进依赖节；Planner 在 BL-TRANSITION-LOG spec 评审时钉死；本批次 spec 显式引用该契约版本 |
| 2 | **归因混入误差（三类）**：① 同项目同时段非批次用量（如批次期间人在同 repo 手动问答）；② 同 repoKey 多设备各建 HarnessProject（`@@unique([deviceId, repoKey])` schema.prisma:343），projectId join 会把两台机器的用量都算进单侧批次窗口；③ 非 git 项目 projectId 关联不通 | 误差方向恒为「只多不少」（时间窗是超集）——UI 固定显示精度声明（F002 acceptance 2）；F004 实测量化误差；②③ 在声明文案与 spec 的 known-limitation 节如实列出；v2 用 agent 侧 batch id 消除 |
| 3 | fix 轮数多时区间查询放大（每区间一次 groupBy） | 区间上限 60 + `Promise.all` 并发 + `@@index([projectId, occurredAt])`（schema.prisma:224 已在）+ 30s `unstable_cache`；F001 测试覆盖合并逻辑 |
| 4 | push=deploy，批次中途生产始终在滚动 | 三个 generator feature 独立 commit、每 commit 自足可运行；先 F001（纯新增文件，UI 零变化，部署无感）再 F002/F003；无 migration 无 env，回滚单 revert |
| 5 | 往 summaries.ts（1128 行、无集成测试）加代码会加重既有短板 | 全部新逻辑进独立 `src/server/harness-cost.ts`，只 import 共享口径函数；纯函数占比最大化使其成为测得住的模块 |
| 6 | 两页卡片成本口径漂移（各自算各自的） | F003 acceptance 1 钉死同口径同值；两页共用 F001 同一个缓存包装导出，不许各写 where |

## 规模估计

**M** · **4 features**（3 generator + 1 evaluator）· 涉及文件约 **10 个**：

- 新增 4：`src/server/harness-cost.ts` · `tests/server/harness-cost.test.ts` · `docs/specs/BL-COST-BATCH-V1-spec.md`（Planner 硬性产物）· `docs/test-reports/BL-COST-BATCH-V1-attribution-audit-*.md`
- 修改 5：`app/harness/[id]/page.tsx` · `app/harness/[id]/views.tsx` · `app/projects/[id]/page.tsx` · `messages/en.json` · `messages/zh-CN.json`
- 不动：`src/server/harness-detail.ts`（所需字段已在 select 内）· `src/server/summaries.ts` · `src/cli/**` · `prisma/schema.prisma` · `src/shared/agent-feature-version.ts`

预计单会话快车道可完成（F001 体量最大约占一半）；建议排在 BL-TRANSITION-LOG 落库并至少积累一个真实批次的 transitions 之后启动，使 F004 有真数据可审。