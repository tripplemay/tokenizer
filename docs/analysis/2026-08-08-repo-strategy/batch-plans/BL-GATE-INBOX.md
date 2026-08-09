# BL-GATE-INBOX 落地方案

> 规划前实地核对说明：任务简报称「批准入口埋在 /harness/[id] 详情页」——实核不符。`GateActions` 全仓唯一使用处是**列表页** `app/harness/page.tsx:147`，且该页顶部已跨项目聚合本人全部未消费闸门（`app/harness/page.tsx:49-57` 查 `HarnessGate where userId, consumedAt: null`，含 approve/reject 与 note）。详情页闸门只读（`app/harness/[id]/views.tsx:582-614`）。**即「收件箱聚合」本体已存在**，真实缺口是：① 离开 /harness 页就看不到待批数（导航零徽章、零通知）；② evidence 只渲染裸路径字符串（page.tsx:124-130）；③ dashboardUrl / artifactPath 两处存而不显。本方案据此把重心放在「全局触达 + 补显」，不重复造收件箱页。

## 目标

把人闸门从「要主动开 /harness 刷」变成「在任何页面、甚至不开控制台都能被触达」：全站常驻待批徽章 + 闸门邮件通知（复用既有 Resend 基建），并补齐三处存而不显（evidence 查看先行版 / dashboardUrl / dispatch 产物），全程零 agent↔服务端协议改动。

## 范围（In / Out）

**In：**
- 全局待批徽章（navbar 常驻 + 轻量 count API + 30s 轮询）
- 闸门 raised/re-raised 邮件通知（Resend REST，claim 式防重发，fail-open）
- evidence 查看**纯服务端先行版**：路径分类徽标 + 一键复制，收件箱卡片与详情页共用组件
- dashboardUrl 补显（详情 overview + 列表卡片外链，经 `safeHttpUrl` 过滤）
- dispatch run `artifactPath/artifactSha256` 补显（detail 查询 + Activity 表格加列）
- 配套 migration（1 列）、i18n（en + zh-CN）、单测、spec 文档

**Out（刻意不做）：**
- **独立 `/harness/inbox` 新页**：现有 /harness 闸门区即收件箱本体，另起一页会造出两个批准面（双份 i18n/测试/审计路径）；徽章深链到 `/harness` 即可。若未来项目数大到闸门区被项目卡片淹没，再拆页（归后续 UX 批次）。
- **evidence 内容上传/内联查看**：内容在机器上，服务端拿不到，必须 agent 上传 → 协议改动。且 report 上报体上限 256KB（`src/server/harness-mode-intent-api.ts:29` `HARNESS_REPORT_MAX_BYTES`），塞不下 512KB 级文件（通道 A 上限先例见 `framework/harness/console-mode.md:324`），需要独立上传 endpoint + `AGENT_FEATURE_VERSION` bump 至 10。**整体推迟**到独立批次（建议命名 BL-GATE-EVIDENCE-UPLOAD），本批次只做先行版。
- webhook / 移动推送等第二通知渠道（邮件先行，验证触达价值后再扩）。
- 决策 `expires_at` 限期授权（远期企业治理层，`src/server/harness-sign.ts` 类型已留）。
- 闸门历史分页（detail take 50 维持不变）。

## Features 预案

**F001 · 全局待批徽章 + pending-count API · executor: generator**
- 涉及文件：`app/api/harness/gates/pending-count/route.ts`（新）· `app/_components/pending-gates-badge.tsx`（新）· `src/components/navbar/index.tsx`（169 行，挂载点）· `messages/en.json` · `messages/zh-CN.json`
- acceptance：
  1. `GET /api/harness/gates/pending-count` 无会话 401；有会话返回 `{ pending: <n> }`，n = `HarnessGate` count where `userId = session.user.id AND consumedAt = null AND decisionAction = null`（单测断言查询条件与 401 分支）
  2. n>0 时 navbar 渲染红底计数徽章且为 `<Link href="/harness">`；n=0 或 fetch 失败时不渲染任何徽章（组件单测覆盖三分支）
  3. 轮询间隔为 30_000ms 常量且与 `app/_components/auto-refresh.tsx` 的 /harness 页刷新节拍一致（单测断言导出常量）
  4. `npm run verify` 与 `npm run lint` 全绿

**F002 · 闸门邮件通知 · executor: generator**
- 涉及文件：`prisma/schema.prisma`（HarnessGate 加 `notifiedAt DateTime?`）· `prisma/migrations/20260810000000_add_harness_gate_notified_at/migration.sql`（新）· `src/server/harness-gate-notify.ts`（新：claim + 渲染 + Resend REST 发送）· `app/api/harness/report/route.ts`（gate 分支 602-650 需向事务外返回 created/re-raised 标记；re-raise 清 decision 字段处一并置 `notifiedAt: null`；事务提交后 fire-and-forget 调用 notify）
- acceptance：
  1. 新 gate 入库后触发通知，claim 式防重发：`updateMany({ where: { id, notifiedAt: null }, data: { notifiedAt: now } })` 计数为 1 才发送——单测模拟两次并发调用只发一封
  2. `AUTH_RESEND_KEY` 未配置或用户 email 为空 → 静默跳过且 report 返回 200（fail-open，通知故障不得卡上报通道；单测）
  3. 发送 fetch 失败 → report 仍 200，`notifiedAt` 复位 null 以便下轮重试（单测 mock fetch 拒绝）
  4. re-raise（既有 consumed gate 且 raisedAt 更新，report/route.ts:618-633 分支）清空 `notifiedAt` → 再次通知（单测）
  5. 邮件正文含项目名 / kind / batch / fromStatus→toStatus / raisedAt（UTC ISO 8601）与控制台链接（`NEXT_PUBLIC_APP_URL` 优先，回落 request origin——先例 `app/api/admin/enrollment-tokens/route.ts:36`）；对渲染纯函数做快照单测
- 备注：Resend 基建已在（`src/auth.ts:38-49`，`AUTH_RESEND_KEY`/`AUTH_EMAIL_FROM` 已是生产 env），直接调 REST API，**零新依赖**。

**F003 · evidence 查看先行版 · executor: generator**
- 涉及文件：`src/shared/harness-evidence.ts`（新：路径分类纯函数——`docs/` 前缀 → repo 取证文件 / 其他 → 普通路径；含长度与字符防御，输入已被服务端限 ≤512 字符 50 条，`app/api/harness/report/route.ts:360-366`）· `app/harness/evidence-list.tsx`（新 client 组件：路径 + 分类徽标 + `navigator.clipboard` 复制按钮）· `app/harness/page.tsx`（124-130 裸 `<ul>` 替换）· `app/harness/[id]/views.tsx`（overview pendingGate 段 ≈194-201 与 activity gates 段 582-614 接入）· `messages/en.json` · `messages/zh-CN.json`
- acceptance：
  1. 分类纯函数单测：`docs/test-reports/x.md` → kind=repoDoc；`tests/x.test.ts` → kind=path；空串/超长输入不抛异常
  2. `grep -n "list-inside list-disc" app/harness/page.tsx` 不再命中原裸列表；三处渲染点均引用 `EvidenceList`（grep 断言）
  3. 复制按钮点击后剪贴板内容 === 原始路径字符串（组件单测或 evaluator UI 断言）
  4. evidence 为空数组时组件不渲染（单测）
  5. `npm run verify` 全绿

**F004 · dashboardUrl 补显 · executor: generator**
- 涉及文件：`app/harness/[id]/views.tsx`（OverviewView identity/outcomes 段加外链 Fact，数据已在查询 `src/server/harness-detail.ts:17`）· `app/harness/page.tsx`（活跃项目卡片加小外链图标）· 复用 `src/shared/url.ts:5` `safeHttpUrl` · `messages/en.json` · `messages/zh-CN.json`
- acceptance：
  1. `dashboardUrl` 非空且 `safeHttpUrl` 通过 → 渲染 `target="_blank" rel="noopener noreferrer"` 外链；`javascript:` 等协议被拒渲染（单测走 safeHttpUrl 既有测试 `tests/shared/url.test.ts` 补 case 即可）
  2. 为空 → 显示既有 `notReported` 文案，不渲染 `<a>`（evaluator UI 断言）
  3. `grep -rn "dashboardUrl" app/` 命中数 >0（当前为 0，机械验证补显完成）

**F005 · dispatch 产物补显 · executor: generator**
- 涉及文件：`src/server/harness-detail.ts`（dispatchRuns select 81-104 补 `artifactPath/artifactSha256` 两列）· `app/harness/[id]/views.tsx`（617-654 表格加「产物」列：path mono 换行 + sha256 截断显示、title 出全量）· `tests/server/harness-detail.test.ts`（**注意**：22-23 行现有断言明确排除这两列——当时归为 raw/sensitive；需反转断言并在 commit message 说明依据：两字段入库前已过服务端校验——repo-relative ≤512 无穿越（`src/server/harness-mode-intent-api.ts` `repoRelativeArtifactPath`，≈1055-1070 行）、sha256 格式校验（同文件 `SHA256_PATTERN`:22），非 raw 通道）· `messages/en.json` · `messages/zh-CN.json`
- acceptance：
  1. `ownedHarnessProjectDetailQuery` 的 dispatchRuns select 含两列（更新后的单测断言）
  2. 表格新列渲染 path 与 sha256（前 12 位 + title 全量）；两者皆空显示 "—"（evaluator UI 断言）
  3. `decisionSig` / intent `payload`/`signature` 仍被排除（保留原测试其余断言，防止顺手扩大暴露面）
  4. `npm run verify` 全绿

## 数据模型 / migration

| 变更 | 内容 |
|---|---|
| `HarnessGate.notifiedAt DateTime?` | 邮件通知 claim 标记；nullable、无默认值、不加索引（查询总是按 id 单行 claim） |
| migration | `20260810000000_add_harness_gate_notified_at`（命名循 `prisma/migrations/` 既有约定）；纯 additive，`npx prisma migrate deploy` 对旧行零影响，可安全滚动部署 |

其余四个 feature 零 schema 变更（artifactPath 两列 `prisma/schema.prisma:443-444` 已在库中）。

## API 与协议影响

- **新增 endpoint：** `GET /api/harness/gates/pending-count`（next-auth 会话鉴权，只读，仅浏览器消费）。
- **修改 endpoint：** `POST /api/harness/report` 内部行为（gate 落库后触发通知、re-raise 清 notifiedAt）——**请求/响应契约字段不变**，旧 agent 无感知。
- **agent↔服务端协议：零改动。** agent 侧（`src/cli/`）一个文件不碰。
- **AGENT_FEATURE_VERSION：不 bump**，维持 9/9（`src/shared/agent-feature-version.ts:50-51`）——无任何新能力要求 agent 升级；将来 evidence 上传批次才需要 bump 至 10（届时显式标注协议影响）。
- **部署触发：** 本批次改 `app/` `src/` `prisma/` `messages/`，全部**不在** `deploy-vps.yml:9-28` paths-ignore 内 → **push main 即部署生产**。建议 building 期间各 feature 本地独立 commit、阶段末一次 push（一次滚动部署、migration 与代码同 deploy 原子生效）；spec/进度类文件随时可推（已豁免）。
- 生产 env 依赖：`AUTH_RESEND_KEY`/`AUTH_EMAIL_FROM` 已在（登录魔链在用）；`NEXT_PUBLIC_APP_URL` 若生产未配则邮件回落 request origin，不阻塞。

## 测试计划

| 文件 | 状态 | 关键用例 |
|---|---|---|
| `tests/server/harness-gates-pending-count.test.ts` | 新增 | 401 / count 查询条件（userId + consumedAt null + decisionAction null）/ 响应形状 |
| `tests/server/harness-gate-notify.test.ts` | 新增 | claim 防重发、无 key 跳过、发送失败复位 notifiedAt、re-raise 重新通知、邮件渲染（UTC 时间戳 + 链接） |
| `tests/server/harness-detail.test.ts` | 修改 | 反转 artifact 两列断言；保留 decisionSig/payload/signature 排除断言 |
| `tests/shared/harness-evidence.test.ts` | 新增 | evidence 路径分类边界（docs/ 前缀、空串、超长、路径穿越样式输入） |
| `tests/shared/url.test.ts` | 修改 | 补 dashboardUrl 场景 case（javascript: 拒渲染） |
| 徽章组件测试 | 新增（放 `tests/shared/` 循 `mode-badges.test.ts` 先例） | n=0/n>0/fetch 失败三分支 |
| report route 现有 gate 单测归属 | 未核 | 现有 report gate 分支测试的确切文件位置未逐一核对；Generator 实现 F002 时先 `grep -rn "harnessGate" tests/server/` 决定并入或新建 |

回归：`npm run test` 全量 + `npm run verify`。

## 依赖与前置

- **前置依赖：无**（所有数据已入库，纯服务端 + UI 薄改动，与路线图近期总原则一致）。
- **同期互斥：** BL-TRANSITION-LOG 也要改 `app/api/harness/report/route.ts`（upsert 处 diff status）——两批次**建议串行**（先后均可），避免同文件并行冲突。
- **被依赖：** BL-GATE-EVIDENCE-UPLOAD（未来，agent 上传 evidence 内容，复用本批次 EvidenceList 组件与分类函数）；通知渠道扩展批次（webhook/推送，复用 notify 模块的 claim 骨架）。

## 风险与对策

| 风险 | 对策 |
|---|---|
| push=部署：building 中途 push 造成半成品上生产 | feature commit 本地积攒，阶段边界一次 push；migration 为 additive nullable，先于代码生效也安全 |
| 邮件重发/骚扰（agent 60s 每轮上报同一 gate） | report route 的 gate upsert 对已存在 gate 只 update detail/evidence（route.ts:634-639），不触发通知；通知仅在 create 与 re-raise 两个事务路径触发 + notifiedAt claim 双保险 |
| 通知/徽章故障拖垮批准主通道 | 全部 fail-open：notify 在事务外 fire-and-forget；徽章 fetch 失败静默隐藏（与 harness.ts:319-332「镜像问题不卡批准通道」同一原则） |
| artifact 列曾被测试判定为敏感字段，补显被误读为放宽红线 | commit message 附机械依据（服务端 `repoRelativeArtifactPath` + `SHA256_PATTERN` 校验链）；evaluator 复核暴露面未扩大（decisionSig 等仍排除） |
| 轮询增加 DB 压力 | count 查询走 `HarnessGate @@index([userId])`（schema.prisma:385），30s/会话一次，量级可忽略 |
| Resend 发信域名/额度 | 与登录魔链共用同一 from 域，gate 事件为低频（人闸门天然稀疏）；失败即复位重试，不丢通知 |

## 规模估计

**M** · 5 features（全部 executor:generator，普通批次 `planning → building → verifying → done`）· 涉及文件约 16 个（新建 7：count route / badge / notify 模块 / evidence 组件 / 分类函数 / migration / 2 个新测试文件按 1 计；修改 9：schema / report route / harness-detail / page.tsx / views.tsx / navbar / 两份 messages / 既有测试 2 处）。另附硬性规格文档 `docs/specs/BL-GATE-INBOX-spec.md`（paths-ignore 内，可随时推）。