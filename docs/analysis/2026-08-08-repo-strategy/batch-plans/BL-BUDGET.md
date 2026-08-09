# BL-BUDGET 落地方案

## 目标

为用量域补上完全空白的预算层：用户可按 **user 全局 / project / model** 三级 scope 设置**月度花费上限（USD）**，系统在月内估算花费到达 **75% / 90%**（Claude Enterprise 既成参数，固定不做自定义）时给出可见告警——全站 banner + overview 成本卡变色 + 独立 `/budgets` 管理页。**预算超限只告警、不熔断**：tokenizer 是观测面不是网关，不在任何链路上拦截 agent 的采集与上报，这是本批次刻意声明的产品边界。全批次零 agent 侧改动、零协议改动。

## 范围（In / Out）

**In：**
- `Budget` 表（tenant-scoped，仿 `QuotaSnapshot` 的租户建模，schema.prisma:231-250 为参考）+ migration
- 预算聚合服务层（month-to-date 花费按三 scope 计算，成本口径与 overview `totalCost` 完全同源：`estimateCost` + `getEffectivePrices`）
- Budget CRUD API（session 认证，浏览器通道）
- `/budgets` 管理页 + 侧边导航项 + i18n（en / zh-CN）
- 全站告警 banner（挂 layout 的既有 banner 槽，与 UpgradeBanner 同位叠放）+ overview 成本 HeroCard 阈值变色
- 周期裁决：**用户时区自然月**（理由见「风险与对策」#3 与下文 F002）

**Out（刻意不做）：**
- **email / webhook / 推送触达** —— 通知基建为零，留给后续独立批次（roadmap「告警先做 UI banner」明示分步）；Budget 表 + level 计算就是它的地基
- **熔断 / 限流 / 配额执行** —— 永久不做，产品边界如上
- **心跳响应下行预算标记（agent CLI 显示预算状态）** —— 触碰 agent↔服务端协议，违背近期总原则，若将来要做归入协议批次单独裁决
- **per-device / per-source / project×model 组合 scope** —— YAGNI，单维三级够用
- **自定义阈值列、告警 acknowledge/静默机制** —— 固定 75/90 常量；banner 常显直到月翻转或用户调 cap；将来要做可平滑加列
- **批次/阶段维度预算** —— 依赖 BL-COST-BATCH-V1 的归因数据，届时扩展 `scopeType` 即可

## Features 预案

### F001 · Budget 表 + migration + 共享常量 · executor: generator
**涉及文件：**
- `prisma/schema.prisma`（新增 `model Budget`，建议插在 QuotaSnapshot 之后 ~250 行处；`User` 模型 relation 列表同步加 `budgets Budget[]`，schema.prisma:14-39）
- `prisma/migrations/20260810000000_add_budget_table/migration.sql`（新；命名跟随现有 `20260806000000_canonicalize_codex_usage_events` 约定）
- `src/shared/budget.ts`（新：`BUDGET_WARN_THRESHOLD = 0.75`、`BUDGET_CRIT_THRESHOLD = 0.9`、`BudgetScopeType`、纯函数 `levelForRatio(ratio): "ok"|"warn"|"crit"|"over"`）

表设计要点：
```prisma
model Budget {
  id            String   @id @default(cuid())
  userId        String
  scopeType     String                      // "user" | "project" | "model"
  scopeKey      String   @default("")       // project.id 或 normalizeModelKey 输出；user 全局用 ""
  monthlyCapUsd Decimal  @db.Decimal(12, 2)
  enabled       Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, scopeType, scopeKey])
  @@index([userId])
}
```
`scopeKey` 用非空 `@default("")` 而不是 nullable——Postgres 的 unique 索引不去重 NULL，nullable 会让「每用户仅一条全局预算」约束失效。

**acceptance：**
1. `npx prisma migrate dev` 在本地空库执行成功，`npx prisma validate` 通过
2. 同 `(userId, scopeType, scopeKey)` 二次插入触发唯一约束错误（测试断言 P2002）
3. `levelForRatio` 单测：0.749→ok、0.75→warn、0.9→crit、1.0→over
4. `npm run verify` 全绿

### F002 · 预算聚合服务层 · executor: generator
**涉及文件：**
- `src/server/budgets.ts`（新：`monthWindowUtc(tz, now)` 与 `getBudgetStatuses(tenantId)`）
- `src/server/summaries.ts`（最小改动：`export` 现有内部函数 `costForWhere`，summaries.ts:61-76，供 user/project scope 复用同一成本口径；不改其逻辑）
- 复用不改：`src/server/time-buckets.ts:70` 的 `wallClockToUtc`（DST 安全的墙钟→UTC 换算）、`src/shared/model-pricing.ts:130` 的 `estimateCost`、`src/server/model-prices.ts:49` 的 `getEffectivePrices`、`src/server/timezone.ts:26` 的 `getUserTimezone`

实现要点：
- **月窗口 = 用户时区自然月**：`monthStart = wallClockToUtc("YYYY-MM-01T00:00", userTz)`，查询仍是纯 UTC instant 区间（`occurredAt >= monthStart`），存储与查询边界全 UTC，符合「时间戳全链路 UTC」；时区只参与窗口推导。走既有索引 `@@index([userId, occurredAt])`（schema.prisma:218）
- **model scope 的归一化匹配**：`UsageEvent.model` 存原始字符串，`scopeKey` 存 `normalizeModelKey` 输出——聚合时 `groupBy(["model"])` 后在 JS 侧以 `normalizeModelKey(row.model) === scopeKey` 过滤求和，与 `estimateCost` 内部同一归一口径，避免 SQL 直配 miss
- **project scope**：where 加 `projectId = scopeKey`
- 未定价模型 `estimateCost` 返回 null → 不计入 spend（与 overview `totalCost` 口径一致），但把 `unpricedTokens` 一并带回供 UI 提示
- 不包 `unstable_cache`：预算条数极少、单聚合查询轻，且 CRUD 写后必须即时可见（管理页直读）；banner 每页渲染一次查询可接受

**acceptance：**
1. 单测：user / project / model 三 scope 聚合值正确（mock prisma，固定 groupBy 返回）
2. 单测：`monthWindowUtc("America/New_York", …)` 断言具体 UTC instant（覆盖夏令时月份），`Asia/Shanghai` 同断言
3. 单测：model scope 下原始模型名（如 `claude-sonnet-4-5-20250929`）经归一化命中 scopeKey；未定价模型 spend 计 0 且 `unpricedTokens > 0`
4. 单测：`enabled: false` 的预算不出现在状态结果中
5. `npm run test` 全绿

### F003 · Budget CRUD API · executor: generator
**涉及文件：**
- `app/api/budgets/route.ts`（新：GET 列表、POST upsert；`requireSession` 认证，模式仿 `app/api/me/timezone/route.ts`）
- `app/api/budgets/[id]/route.ts`（新：PATCH 改 cap/enabled、DELETE）

校验：`monthlyCapUsd` 必须为正有限数（400）；`scopeType` 白名单（400）；project scope 的 `scopeKey` 必须是本租户存在的 `Project.id`（404/400）；model scope 的 `scopeKey` 服务端强制过 `normalizeModelKey`；`[id]` 操作按 `userId` 过滤实现跨租户隔离。

**acceptance：**
1. 未登录请求被 `requireSession` 拒绝（路由单测 mock auth-session）
2. 负数/0/NaN cap → 400；非法 scopeType → 400；他租户 budget id 的 PATCH/DELETE → 404
3. 同 scope 重复 POST 为幂等 upsert（不产生第二行）
4. 路由单测通过（mock prisma，模式仿 `tests/server/harness-decisions-route.test.ts`）

### F004 · /budgets 管理页 + 导航 + i18n · executor: generator
**涉及文件：**
- `app/budgets/page.tsx`（新：server component，`getBudgetStatuses` 直读渲染列表——scope、cap、month-to-date、进度条、level 配色）
- `app/budgets/budget-manager.tsx`（新：client 组件，fetch `/api/budgets` 做新建/编辑/删除；project 下拉数据来自现有 `getProjectSummary`，model 下拉来自 `getBreakdown(tenantId, "model")`，均为 `src/server/summaries.ts` 现有导出）
- `src/routes.tsx`（加 `nav.budgets` 条目）
- `messages/en.json`、`messages/zh-CN.json`（新增顶层 `budgets.*` 键组；现有顶层键无冲突，已核）

**acceptance：**
1. `/budgets` 渲染全部预算及 month-to-date 进度条，≥75% amber、≥90% red、超限深红（与 `levelForRatio` 一致）
2. 新建→列表出现新行；删除→行消失（经 API 往返，刷新后仍一致）
3. en / zh-CN 两 locale 页面均无 missing-message 报错
4. `npm run build` 通过

### F005 · 告警 banner + overview 成本卡变色 · executor: generator
**涉及文件：**
- `app/_components/budget-alert-banner.tsx`（新：server component + 导出纯函数 `shouldRenderBudgetBanner(statuses)`，模式完全仿 `app/_components/upgrade-banner.tsx:11-13` 的可测判断函数）
- `app/layout.tsx`（banner 槽当前只装 UpgradeBanner，layout.tsx:28-44——改为 fragment 叠放两个 banner）
- `app/page.tsx`（HeroSection 的成本 HeroCard，page.tsx:310-324：注入 user 全局预算状态 → 卡片边框/badge 按 level 变色，副文案显示「$spend / $cap · x%」；`HeroCard` 组件加可选 prop，page.tsx:674-730）
- `messages/en.json`、`messages/zh-CN.json`（`budgetBanner.*` 键）

**acceptance：**
1. 任一 enabled 预算 ratio ≥0.75 时全站渲染 banner（amber），≥0.9 红色，文案含 scope 名称与百分比，点击跳 `/budgets`
2. 无预算或全部 <0.75 时不渲染（`shouldRenderBudgetBanner` 纯函数单测覆盖边界 0.749/0.75/0.9/1.0）
3. overview 成本卡在 warn/crit/over 三级下有肉眼可辨的变色 + cap 副文案；无 user 全局预算时卡片与现状完全一致
4. `git diff` 不含 `src/cli/**`、`src/parsers/**`、`src/quota/**`、`src/shared/agent-feature-version.ts`（零 agent/协议改动的机械验证）
5. `npm run verify && npm run test` 全绿

## 数据模型 / migration

- 新增 `Budget` 表一张（见 F001），`User` 加反向 relation。**纯新增，不改任何既有表/列/索引**，migration 无数据回填、可即刻回滚（drop table）。
- 部署路径自动执行：deploy-vps.yml:247 `docker compose run --rm migrate`（内跑 `npx prisma migrate deploy`），无需人工操作。

## API 与协议影响

- **新增 endpoint**：`GET/POST /api/budgets`、`PATCH/DELETE /api/budgets/[id]`——全部走浏览器 session 通道（`requireSession`），**不触碰 device-token 通道**（`/api/usage/events/batch`、`/api/devices/heartbeat`、`/api/harness/*` 零改动）。
- **AGENT_FEATURE_VERSION 不 bump**：预算是纯服务端 + 浏览器面能力，agent 无需感知任何新字段/新行为，不满足 `src/shared/agent-feature-version.ts:14-17` 的 bump 条件（「新能力要求 agent 升级」）；9 个消费者项目的运输层完全不受影响。
- **部署触发说明**：本批次改动 `prisma/`、`src/server/`、`src/shared/`、`app/`、`messages/`、`src/routes.tsx`——全部在 paths-ignore 之外，**每次 push main 都会触发 Verify + 生产部署**（deploy-vps.yml:9-28 已核）。spec 文档（`docs/specs/BL-BUDGET.md`）在 `docs/specs/**` 豁免内，可先行推送。按铁律每 feature 独立 commit 且可运行：F001-F003 是纯增量（新表无人读、新 API 无人调），中间部署态安全；F004/F005 上线即功能可见。

## 测试计划

| 文件 | 状态 | 关键用例 |
|---|---|---|
| `tests/shared/budget.test.ts` | 新增 | `levelForRatio` 四级边界；阈值常量为 0.75/0.9 |
| `tests/server/budgets.test.ts` | 新增（mock prisma，仿 `tests/server/ingest-upsert.test.ts` 的 `vi.mock("@/server/db")` 模式） | 月窗口 UTC 换算（含 DST 时区）；三 scope 聚合；model 归一匹配；unpriced→不计入且计数；disabled 跳过；与 `costForWhere` 口径一致性 |
| `tests/server/budgets-route.test.ts` | 新增（仿 `tests/server/harness-decisions-route.test.ts`） | 认证拒绝；参数校验 400；跨租户 404；upsert 幂等 |
| `tests/server/budget-banner.test.ts` | 新增 | `shouldRenderBudgetBanner` 边界（仿 upgrade-banner 的可测拆分） |

UI 无 E2E 与项目现状一致（app/ 零 E2E 是既有短板，不在本批扩大）。

## 依赖与前置

- **前置依赖：无。** 与 BL-GATE-INBOX / BL-TRANSITION-LOG / BL-COST-BATCH-V1 / BL-AGENT-LATENCY 全部正交，可并行或任意顺序启动。QuotaSnapshot 仅为建模参考，无代码依赖。
- **被依赖：** 后续「通知触达」批次（email/webhook）直接建在 Budget 表 + `getBudgetStatuses` 的 level 输出上；BL-COST-BATCH-V1 落地后若做批次级预算，扩 `scopeType` 枚举即可，不需要改表结构。

## 风险与对策

1. **成本口径为 list-price 估算，非真实账单**（usage 报告短板 7；订阅制用户尤甚）→ UI 全部标注「估算成本」，spec 明示口径 = `estimateCost` 四段定价；预算定位是「观测告警」不是「账单对账」。
2. **未定价模型 spend 计 0 → 预算系统性低估** → 聚合结果附带 `unpricedTokens`，管理页与 banner 在存在未定价 token 时加提示角标，与 overview「数据质量」卡的 unpriced 口径一致（page.tsx:220-226 先例）。
3. **月窗口用用户时区（裁决）**：若用 UTC 自然月，month-to-date 与 daily cost 图（`getDailyCostImpl` 按用户时区分桶，summaries.ts:970）的日条加总对不上，用户会认为数字是错的。代价是用户中途改时区会导致窗口在下次评估时漂移——接受（窗口是查询时点推导，无存储桶，无脏数据），写入 spec 已知限制。
4. **push=deploy 的中间态**：F001-F005 均向后兼容（纯新增），任一中间 commit 部署都不破坏现网；仍按铁律 5 每 commit 可运行、`npm run verify` 过后再推。
5. **Prisma Decimal 序列化**：`monthlyCapUsd` 为 Decimal 对象，跨 server/client 边界前显式 `Number()` 转换（`QuotaSnapshot.utilization` Decimal(6,4) 已有同类处理先例）。
6. **banner 每页一次聚合查询的开销** → 单租户预算行数个位数、查询走 `[userId, occurredAt]` 索引 + `groupBy model` 小结果集；实测慢再上 cache，不预优化。

## 规模估计

**M** · 5 features（全部 executor:generator，普通批次 `planning → building → verifying → done`）· 新文件 ~10（1 migration + 1 schema 段、budget.ts、budgets.ts、2 API route、2 页面组件、1 banner 组件、4 测试文件）+ 既有文件改动 ~7（schema.prisma、summaries.ts 一处 export、layout.tsx、page.tsx、routes.tsx、messages/en.json、messages/zh-CN.json）。所有既有文件路径与行号均实地核对；新文件路径按现有目录约定，migration 时间戳按当日顺延（20260810000000 为占位，落地时取实际日期）。