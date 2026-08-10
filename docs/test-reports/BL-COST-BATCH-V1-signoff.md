# BL-COST-BATCH-V1 验收签署报告

- **批次：** BL-COST-BATCH-V1（成本×批次/阶段归因 v1 + migrations 卫生顺路项）
- **验收形态：** 快车道 fan-out——首轮 5 个上下文隔离 evaluator subagent（F004 为 executor:evaluator 的审计执行）+ fixing 轮后 1 个隔离复验 evaluator
- **判定：** **首轮五分片按 spec acceptance 全 PASS；用户依据同 SHA 独立前端评审 F-31 [P1] 裁决进 fixing 轮（fix_rounds=1）；复验三项修复全 PASS + 零回归 → done**
- **验收 SHA：** 首轮 `c27fb38`（生产已部署）；fixing 轮 `b1e0368`，复验于 `06c1980`
- **署名：** evaluator-subagent ×6（编排者仅机械合并，未改写任何结论）
- **日期：** 2026-08-10（UTC）

## 首轮分片结论索引（全文见本报告 git 历史与各分片证据链）

| Feature | 判定 | 关键证据 |
|---|---|---|
| F001 聚合层 | PASS | 11/11 用例；零 mock 探针实证纯函数无 DB 依赖；4 类测试外边界（乱序/同刻/恰过界/时钟偏斜）全绿；compute 口径与 summaries.ts billableOf 并排 diff 逐字等价 |
| F002 overview 成本卡 | PASS | React 19 真实组件 + 真实 en.json 静态渲染冒烟 4/4（总成本/阶段行/返工小计/精度声明全文）；取数钉 overview 分支；i18n 键集比对 |
| F003 projects 联动卡 | PASS | cache key 字节相等双路实证（渲染 spy + scratch 库真实 Prisma）；无关联不渲染；orderBy tiebreaker 残余风险如实报告（本轮 fixing 已根治） |
| F004 归因审计（executor:evaluator） | PASS | scratch 库 27/27 断言：阶段和=批次总（Δ=0）；混入 $5.15 恰多算 $5.15（35.17% 高估实证）；UTC 边界秒三探针；报告 `BL-COST-BATCH-V1-attribution-audit-2026-08-10.md`（基线 c27fb38） |
| F005 migrations 卫生 | PASS | 反事实核证：摘除修正 migration 重跑 diff --script 与入库 SQL 逐字节一致；scratch 全链 27 条干净；生产 migrate deploy 日志实证 |

## 裁决记录（fixing 轮来源）

同 SHA `c27fb38` 的独立前端全量评审（`docs/test-reports/frontend-code-review-2026-08-10.md`，46 findings）中
**F-31 [P1]** 指出：终态批次持续计费、unpriced 模型静默少算与「只多不少」文案矛盾、>100 流转截断。
分片按 spec acceptance 全 PASS，但 spec 自身精度承诺被证伪于边角。**用户裁决**：F-31 核心三项进
fixing 轮；F-32（查询放大）入 `BL-COST-PERF`；安全簇 P1 立 `BL-SECURITY-P1`（下一批次优先）；
其余 findings 入 `BL-FRONTEND-REVIEW-REMAINDER`。

## 复验（fixing 轮 → reverifying，fix_rounds=1）

**验收对象：** fix commit `b1e0368`（F-31 核心三项），复验于 HEAD `06c1980`，隔离 evaluator subagent（fresh context），署名 `evaluator-subagent`。以下为复验 evaluator 结论**原样收录**：

> **① 终态封闭 — PASS。** `buildPhaseIntervals` 引入 `TERMINAL_PHASES={done}`，末行 done 零宽封闭（`end=start`、`openEnded=false`）。除实跑修复自带用例（tests/server/harness-cost.test.ts:111-125）外，Evaluator 独立构造探针机械证明：now 推至 done 后 30/60 天结果深等（窗口终点恒 = done 时刻）；done 区间下发的 groupBy where 为空窗 `[t,t)`（gte=lt，数学上不可满足）；全部区间 `lt` ≤ done 时刻——done 后插入的用量事件在 getBatchCost 中不可达。「已完成批次总额每 30 秒继续上涨」已消除。
>
> **② unpriced 披露 — PASS。** 未定价模型 tokens 归入 `unpricedComputeTokens`/`hasUnpricedUsage`（计 compute、不计 costUsd），聚合与阶段行逐位正确（实跑用例 + 独立渲染探针：hasUnpricedUsage=true 时详情页渲染披露行含插值 token 数，false 时不渲染）；i18n `harness.detail.cost.unpriced` en/zh 齐备。precisionNote 新文案按铁律 13 逐句核对与实现相符——特别是「A completed batch stops accruing at done」由 ① 的探针背书；全库 grep 无「只多不少 / never under」残留。
>
> **③ orderBy 次级序 — PASS。** `harness-detail.ts` 与 `app/projects/[id]/page.tsx` 两处 transitions 均为 `[{observedAt:"desc"},{id:"desc"}]` + `take:100`，形状逐字一致，同毫秒双行下两页序列化一致（cache key 同一性前提成立）。
>
> **回归 — 零红。** `npm run verify`（exit 0）· `npm run lint`（0 errors / 0 warnings）· 全量 test **1148 passed / 12 skipped** · `npm run build`（Compiled successfully）。
>
> **F004 审计报告注记（随签收在案，不改报告本体）：** 审计报告钉死基线 c27fb38，其 27/27 结论在该基线内仍有效且可复现。b1e0368 的终态封闭语义使以下条目不再代表 HEAD 行为：§2.2 done 开区间期望（HEAD 下零宽 [19:30,19:30)）、S1.2/S1.5.6 及两场景总额（E7 $0.405/22,000 compute 在 HEAD 下不落入任何窗口；HEAD 期望 场景 1 $14.238/691,110、场景 2 $19.388/1,951,110）、S3.4 的排除原因表述、Acceptance 4 引用的旧文案对照表。附录 B 脚本按 §6 在 c27fb38 复跑仍 27/27 PASS；at HEAD 复跑将按上述条目 FAIL——此为语义演进而非审计缺陷，无须重做审计，注记即闭环。
>
> **非阻断观察：** /projects/[id] 联动卡无逐行 unpriced 徽标（note 已如实披露 + 详情页点入可见量化行，文案未夸大，判相符）；建议并入 BL-COST-PERF 或后续 UI 批次。

## Soft-watch 汇总（非阻断）

1. F001 验收探针 4 边界用例（乱序/同刻/恰过界/时钟偏斜）建议折入主套件常驻回归（已记 BL-COST-PERF 描述）。
2. /projects/[id] 联动卡逐行 unpriced 徽标（复验观察，入 BL-COST-PERF）。
3. F-32 查询放大（N×60 groupBy + 量化 nowMs 持续换 key）→ `BL-COST-PERF`（medium）。

## L2 未尽项（生产行为，用户目视）

- harness 详情 overview 批次成本卡与 projects 详情联动卡的登录态走查（本批次自身的 transitions 正是实测数据——本批 fixing/reverifying 轮的成本会出现在卡片上）。
