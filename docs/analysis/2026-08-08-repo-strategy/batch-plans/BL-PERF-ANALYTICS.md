# BL-PERF-ANALYTICS 落地方案

> 规划前实地核对完成。关键事实修正/确认：
> ① `HarnessProject` 确为覆盖式 upsert（`app/api/harness/report/route.ts:593-597`），批次切换即丢历史；
> ② **evaluator_feedback 当前不在 report 载荷中**——progress.json 里有结构化数据（`{summary, pass_count, partial_count, fail_count, issues[]}`，本仓 progress.json 实例可证），但 CLI `buildReport`（`src/cli/harness.ts:206-284`）不读它，服务端 `parseState` 白名单（`report/route.ts:301-316`）没有该字段、`exactRecord` 会以 `unknown_field` 拒收整个上报；
> ③ BL-TRANSITION-LOG 与 BL-COST-BATCH-V1 **均未实施**（`docs/specs/` 无对应 spec，schema 无 `HarnessTransition` 表，grep 零命中）——阶段耗时与批次成本两个维度目前无数据源，只能做软依赖。

## 目标

把 harness 批次从「只存当前」变成「逐批次入史」，并在此之上交付 agent 性能分析页：一次通过率、返工轮数分布、每批次 feature 完成度，与 BL-COST-BATCH-V1 的批次成本合流成「成本×质量」单页。纯服务端 + UI 改动为主体，agent 协议默认零改动（唯一的 additive 协议项单列为可裁剪 feature）。

## 范围（In / Out）

**In：**
- 新表 `HarnessBatchArchive`：批次终态快照，report 事务内服务端触发归档（agent 零改动）
- 聚合查询层 `src/server/harness-analytics.ts` + 新页 `/harness/analytics`（成本×质量合流的信息架构落点）
- 详情页 `/harness/[id]` 增加批次历史 tab
- （可裁剪）evaluator_feedback 有界摘要入 report 载荷——唯一协议项，显式标注

**Out（刻意不做）：**
- **feature 级精确成本归因**：需要 UsageEvent 带 batch/feature 维度，是协议改动，留给 BL-COST-BATCH v2（roadmap §3.2「第二步」）
- **HarnessTransition 表本体**：属 BL-TRANSITION-LOG；本批次只消费它（无则隐藏阶段耗时列）
- **evaluator_feedback.issues 全文入库**：只入有界摘要 + 计数，防载荷膨胀（report 上限 256KB）
- **历史批次回填**：归档前的批次数据在服务端不存在，无法回填；不造假数据
- **跨用户排行 / 导出 / 通知**：留给远期企业治理层
- **session_notes / generator_handoff 入库**：叙事性文本，非聚合口径数据

## Features 预案

**F001 · HarnessBatchArchive 表与服务端归档触发 · executor: generator**
涉及文件：`prisma/schema.prisma`（HarnessProject 块后新增 model）、`prisma/migrations/20260810000000_add_harness_batch_archive/migration.sql`（新建）、`app/api/harness/report/route.ts`（585-591 处 `existingProject` select 扩出 status/batch/fixRounds 等旧值；593-597 upsert 前后插入归档逻辑，同一 serializable 事务内）
归档触发规则（回答「done 后尾部上报」问题）：
- 入 `done`：incoming `state.status === "done"` 且 batch 非空 → 以 `@@unique([harnessProjectId, batch])` upsert 归档行。**upsert 天然吸收尾部上报**——done 之后 signoff 补写、features 终态刷新都会更新同一行；`doneAt` 仅 create 时写入，refresh 不动。附带收益：部署后已处于 done 的项目首次上报即自动归档当前批次（自回填一档）
- 批次切换保底：旧行 `batch` 非空、新 `batch` ≠ 旧 `batch`、旧 `status ≠ "done"` → 用旧行数据落一条 `archivedReason: "superseded"`（中断/弃置批次也入史，不计入通过率分母）
acceptance：
1. vitest 集成测试：模拟 report 序列 building→done，`HarnessBatchArchive` 出现 1 行且 `archivedReason="done"`、`firstPass` 与 fixRounds 一致
2. 同 batch 第二次 done 上报（signoff 从 null 变为路径）：行数仍为 1，signoff 已刷新，`doneAt` 不变
3. 旧 status=verifying 下直接换 batch 上报：产生 `superseded` 归档行，快照字段等于旧行值
4. 跨用户隔离：他人 token 无法读/写归档行（沿用 userId 过滤模式）
5. `npx prisma migrate dev` 在空库与既有库均干净通过，`npm run verify` 全绿

**F002 · 性能聚合查询层 · executor: generator**
涉及文件：`src/server/harness-analytics.ts`（新建）、`tests/server/harness-analytics.test.ts`（新建）
口径钉死（写进模块头注释与 spec）：
- **一次通过率** = `archivedReason="done"` 且 `fixRounds === 0` 的批次 / 全部 `archivedReason="done"` 批次；superseded 不入分母，单列展示
- **Evaluator-only 批次标记**：features 快照中全部 `executor:"evaluator"` 的批次天然无 fixing 环（状态流转图跳过 building），单独打标，避免虚增通过率
- **返工轮数** = fixRounds 的均值 / 最大值 / 直方图
- **每 feature 成本** = 批次成本 ÷ totalCount；批次成本经 BL-COST-BATCH-V1 的时间窗 join 提供（其模块路径未核——该批次未实施；本层定义 `getBatchCost?: (repoKey, window) => ...` 注入接口，数据缺席时返回 null，UI 隐藏成本列）
- 阶段耗时：查 `HarnessTransition`（BL-TRANSITION-LOG）——表不存在期间该维度返回 null
acceptance：
1. 种子数据单测：3 done（1 个 fixRounds=0）+ 1 superseded → 通过率 = 1/3，superseded 计数 = 1
2. evaluator-only 批次被打标且可从通过率口径中区分
3. 成本注入函数缺席时聚合结果 cost 字段为 null 且不抛错
4. 时间边界断言全 UTC（复用现有 `parseUtcDate` 约定）

**F003 · /harness/analytics 成本×质量页 · executor: generator**
涉及文件：`app/harness/analytics/page.tsx`（新建）、`app/harness/page.tsx`（头部加入口 Link，仿 182 行既有 Link 模式）、`messages/en.json` + `messages/zh-CN.json`（`harness` 命名空间下新增 key，en.json:473 起）
信息架构（合流方案）：本页是「成本×质量」的**唯一落点**——KPI 行（一次通过率 / 平均返工轮数 / 已归档批次数 / 每 feature 平均成本）+ 按项目分组的批次历史表（批次 · 终态 · fixRounds · features 完成比 · signoff 有无 · 成本 · 阶段耗时，后两列无数据则整列隐藏）。BL-COST-BATCH-V1 若先落了批次成本卡片，其查询函数被 F002 注入复用，不做第二个半页
acceptance：
1. 种子数据下页面 SSR 渲染出 KPI 与批次表（vitest 或 build 后 route 冒烟）
2. 零归档数据时渲染空态文案而非报错
3. `getTranslations("harness")` 覆盖全部新增文案，en/zh-CN 双语 key 齐备（`npm run build` 通过）
4. 页面沿用 `requireSession` + userId 过滤（越权访问他人数据返回空）

**F004 · 详情页批次历史 tab · executor: generator**
涉及文件：`src/server/harness-detail.ts`（3-107 的 select 增加 `batchArchives` take 50，仿 gates 的写法）、`app/harness/[id]/page.tsx`、`app/harness/[id]/views.tsx`（新增 history tab 组件，仿 617-654 dispatch 表格模式）
acceptance：
1. `tests/server/harness-detail.test.ts` 扩展：detail 查询含归档行且按 doneAt 倒序
2. 有归档的项目详情页出现 history tab，行内含 fixRounds 徽章与 firstPass 标记
3. 无归档项目不显示该 tab（或显示空态），不影响既有三 tab

**F005 · evaluator_feedback 有界摘要入库 · executor: generator ·（协议影响·可裁剪，批次内最后实施）**
涉及文件：`src/cli/harness.ts`（186-198 `ProgressJson` 类型 + 257-279 state 组装，新增 `evaluatorFeedback: {summary≤512, passCount, partialCount, failCount, issueCount}`）、`app/api/harness/report/route.ts`（301-316 白名单 + 解析器）、`prisma/schema.prisma`（HarnessProject + HarnessBatchArchive 各加 `evaluatorFeedback Json?`）、对应 migration
协议影响标注见下节。若编排者裁剪本条，F002/F003 的质量口径不受影响（fixRounds/signoff 已足够 v1）
acceptance：
1. `tests/cli/harness.test.ts`：progress.json 含 evaluator_feedback 时 buildReport 产出有界摘要；畸形/超长时整字段省略而非报错
2. 服务端测试：带该字段的上报入库；**不带该字段的旧载荷仍被接受**（回归防线，仿 `tests/server/harness-report-mode-intent.test.ts` 的兼容用例）
3. 归档行携带 done 时刻的 feedback 快照
4. `AGENT_FEATURE_VERSION` 与 `MIN_AGENT_FEATURE_VERSION` 均未改动（git diff 断言该文件零改动）

**F006 · 归档与口径独立审计 · executor: evaluator**
涉及文件：`docs/test-reports/BL-PERF-ANALYTICS-audit-<date>.md`（新建）、`docs/test-cases/`（用例）
内容：隔离上下文实测归档触发矩阵（done / 尾部刷新 / superseded / 幂等重放）、用生产镜像库 spot-check 通过率口径、核对 F005（若保留）的旧 agent 兼容路径
acceptance：
1. 报告落盘且覆盖全部四种触发场景的实跑证据
2. 口径复算与 F002 输出一致或列出偏差
3. 结论原样入 progress.json evaluator_feedback

## 数据模型 / migration

新表 `HarnessBatchArchive`（一条 migration，纯 additive）：
`id · userId · harnessProjectId(FK, Cascade) · repoKey(冗余，展示用) · batch · status · fixRounds · completedCount · totalCount · headSha · signoff · dashboardUrl · features Json · firstPass Boolean · archivedReason("done"|"superseded") · doneAt DateTime? · reportedAt · createdAt/updatedAt`
约束：`@@unique([harnessProjectId, batch])`（幂等 upsert 键）、`@@index([userId])`、`@@index([doneAt])`
F005 附加：`HarnessProject.evaluatorFeedback Json?` + `HarnessBatchArchive.evaluatorFeedback Json?`（可与 F001 migration 合并或独立，视裁剪决定）
迁移命名沿用 `20260810000000_add_harness_batch_archive` 式样（对齐 `prisma/migrations/` 既有序列，末项 20260806000000）。

## API 与协议影响

- **无新增 endpoint**：两个新页面均为 server component 直查（与 `/harness` 既有模式一致）；report/gates/decisions 契约不变
- **F001-F004 协议零影响**：归档在 report 事务内由服务端 diff 触发，9 个消费者项目的 agent 一行不改、旧版本完整受益
- **F005 是本批次唯一协议项（additive-optional）**：新 agent 发新字段、旧 agent 省略照常。安全性由部署顺序结构性保证——push main 先部署服务端（白名单已放行），agent 升级永远是之后的手动 reinstall；风险点是服务端回滚后已升级 agent 的上报会被 `unknown_field` 整单拒收，故 F005 排批次末尾、独立 commit 可单独 revert
- **AGENT_FEATURE_VERSION 不 bump**：`src/shared/agent-feature-version.ts:50-51`（当前 9/9）保持不动。依据即该文件自述规则——bump 仅用于「必须提示用户升级」的能力；本批次旧 agent 全功能可用，F005 缺席只是归档少一个可空字段，属「stragglers are acceptable」
- **部署触发**：本批次改 `prisma/** · app/** · src/**`，均不在 `deploy-vps.yml` paths-ignore 内——**每次 push main 即部署生产**。migration 纯 additive（新表 + 可空列），`npx prisma migrate deploy` 零停机；要求每个 feature 独立 commit 且推送时点自可运行（铁律 5），建议 F001+F002 验证后一并推送，减少部署次数

## 测试计划

| 文件 | 新/改 | 关键用例 |
|---|---|---|
| `tests/server/harness-batch-archive.test.ts` | 新 | 触发矩阵：入 done 建档 / 尾部上报刷新不重建 / 批次切换 superseded / doneAt 不被 refresh 改写 / 跨用户隔离 |
| `tests/server/harness-analytics.test.ts` | 新 | 通过率口径（含 evaluator-only 排除）、fixRounds 分布、成本注入缺席降级、UTC 边界 |
| `tests/server/harness-detail.test.ts` | 改 | detail 查询含 batchArchives，take 与排序 |
| `tests/cli/harness.test.ts` | 改（仅 F005） | buildReport 有界摘要、畸形省略 |
| `tests/server/harness-report-mode-intent.test.ts` 同目录新增兼容用例 | 改（仅 F005） | 无 evaluatorFeedback 旧载荷回归通过 |

全量门槛：`npm run verify` + `npm run test` 全绿（现有 harness 相关测试 cli 8 + server 8 + shared 4 不得回归）。

## 依赖与前置

- **软依赖（建议先行，非阻塞）**：BL-TRANSITION-LOG（阶段耗时列数据源）、BL-COST-BATCH-V1（批次成本数据源）。两者均未实施（已核）；本批次按「列缺省隐藏」降级交付，join 接口以注入形式预留，二者落地后分析页自动点亮对应列
- **硬前置**：无。F001 归档不依赖任何在途批次
- **被依赖**：远期看板编排面与企业治理层需要批次历史；BL-COST-BATCH v2（feature 级归因）需要本批次的 batch 归档作对账基准。**建议归档表（F001）尽早合入——归档晚上线一天，就是一天的批次历史永久丢失**

## 风险与对策

| 风险 | 对策 |
|---|---|
| agent 停机期间批次整个走完又开新批次，done 快照从未上报 | superseded 保底归档最后已知快照并显式打标；UI 标注「未记满」，不入通过率分母 |
| fixRounds=0 口径被 evaluator-only 批次虚增 | F002 用 features executor 快照打标排除，口径写进模块头注释 + spec |
| 尾部上报覆盖掉 done 时刻快照（如后续实验性改动） | 仅刷新 signoff/features/reportedAt 等白名单字段，doneAt/firstPass create 后不动 |
| F005 服务端回滚 + 新 agent 组合导致上报整单被拒 | F005 独立 commit 置批次末尾，可单独 revert；服务端白名单改动与 agent 端改动同 feature 同 commit（保证任何部署点自洽） |
| push=部署，批次中途 push 出半成品 | 每 feature commit 自可运行；migration 与消费代码同 commit；验收后再推送的节奏由编排者控制 |
| legacy repoKey alias 迁移（`reconcileHarnessProjectIdentity`，report/route.ts:198-266 区域）与归档行归属 | 归档挂 harnessProjectId 外键，随 reconcile 后的项目行走，Cascade 语义与 gates 一致，无需特判（F006 审计覆盖） |

## 规模估计

**M** · 6 features（5 generator + 1 evaluator）· 主要涉及文件约 14 个（schema + 1-2 条 migration + report route + analytics 查询层新 1 + 页面新 2 改 3 + i18n 2 + 测试新 2 改 3；F005 另计 cli 1 + 测试 2）。若裁剪 F005，降为 S+/M-，协议影响归零。