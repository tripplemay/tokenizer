# BL-SECURITY-P1 规格 —— 前端评审 P1 安全专批（+ F-32 查询放大治理）

- **批次目标：** 关闭 `frontend-code-review-2026-08-10` 的 P1 安全簇六项（认证边界 / 开放重定向 / 存储型 XSS / 决策竞态 / 注册误判 / 跨账号财务口径），并顺路治理上一批刚上线的批次成本查询放大（F-32）。
- **来源报告：** `docs/test-reports/frontend-code-review-2026-08-10.md`（锁定 `c27fb38`，报告已在 `905a90b` 复核）
- **执行形态：** v2 non-fast · profile=`heterogeneous` · intent `da55b68a`（2026-08-10 消费）
  - Planner = **Coordinator**（`role_bindings.planner=null`，本主会话）
  - Generator = `local-cli--codex--generator`（model_family=codex）
  - Evaluator = `local-cli--kimi--evaluator`（model_family=kimi）—— 与 generator family 互斥 ✓
  - 混合批次（7 generator + 1 evaluator）→ `building` → `verifying`
- **硬约束：**
  - 零 agent 协议改动 · `src/cli/**` 一字不动 · `AGENT_FEATURE_VERSION` 两常量不动（F006 已核查确认无需 bump）
  - 🔴 **上报热路径不得引入不自愈的整批拒收**（2026-08-10 F003 首轮拒收后追加）：`POST /api/usage/events/batch`
    与 `POST /api/devices/heartbeat` 上任何**新增**校验都不得以 4xx 废掉整批。原因是机械的——`src/cli/sync.ts:51`
    非 ok 即抛，`syncBatchWithRetry` 仅 2 次固定延迟重试，而 `src/cli/agent.ts:65-67` 的 `clearQueue()` /
    `writeCursor()` **只在 sync 成功后执行**：一条永远被拒的事件会把该设备的队列与游标永久钉死，每 tick 重发同一批，
    该设备从此再无用量入库且不会自愈。热路径一律**服务端清洗**（截断 / 剥控制字符）后入库；硬拒收只允许出现在
    `enroll` 这类交互式、用户能立刻看到错误的首次接触路径。
  - F001–F007 **push 即部署**，各自独立 commit 以便单条 revert
  - F007 不得使批次成本口径漂移：`BL-COST-BATCH-V1` F004 审计（27/27）与既有 `tests/server/harness-cost.test.ts` 是回归 oracle
  - Evaluator 只写 `tests/` 与 `docs/test-reports/`，不碰产品代码

## 源码核查结论（Planner 铁律 1 / 铁律 2 —— 报告断言按线索处理）

八处引用逐条比对实物，**全部属实**；其中两处核查改变了方案成本：

| 报告项 | 引用位置 | 核查结论 |
|---|---|---|
| F-01 | `src/auth.ts:11-13` · `deploy-vps.yml:194-196,214` | ✅ 属实。任何环境下缺 `AUTH_SECRET` 即写入固定占位串；workflow 仅 warning 且把**空值**写进 `.env`，运行时空串落回同一占位 |
| F-02 | `app/login/page.tsx:12` | ✅ 属实。`redirect(params.callbackUrl ?? "/")` 零校验（仅已登录用户路径命中） |
| F-05 | `daily-device-cost-chart.tsx:73-80` · `daily-source-chart.tsx:84-92` | ✅ 属实。`${item.name}` 直接进 HTML template，经 ApexCharts `custom` → innerHTML |
| F-33 | `app/api/harness/gates/route.ts:73-84,112-121` | ✅ 属实。read→check→sign→`update({where:{id}})` 无 CAS 无事务 |
| F-35 | `src/server/quota.ts:44-53` · `schema.prisma:233-251` | ✅ 属实。`DISTINCT ON (provider, windowKey)` 漏 `accountKey`；卡片取首行 accountKey 而 windows 可跨账号 |
| F-32 | `harness-cost.ts:193,214-232` · `projects/[id]/page.tsx:31-54,76-85` | ✅ 属实。`Promise.all` 逐区间 groupBy（上限 `MAX_PHASE_INTERVALS=60`）；`harnessProject.findMany` **无 take**；`nowMs` 进 cache key |
| **F-04** | `enroll-flow-card.tsx:86-91` · `enrollment-tokens/route.ts:25-33,47-52` · `summaries.ts:1122` | ✅ 现象属实（匹配任意新 deviceId；`getDeviceSummary` 确为 30s `unstable_cache`）。**但报告的修法已部分存在**：`EnrollmentToken.usedAt/usedById` 已在 schema（`:139-156`），enroll 路由 `:39-44` 已把本次设备 id 写入 `usedById`。⇒ **零 schema 改动、零协议改动**，只需暴露 enrollment id + 一个不可缓存的查询端点 |
| **F-01 构建面** | `Dockerfile:8-15` | 🔴 **陷阱**：builder 阶段跑 `next build`，而 `next build` 内部把 `NODE_ENV` 置为 `production`。若 fail-closed 判据只看 `NODE_ENV==='production'`，**镜像构建当场即断**。判据必须用构建期信号区分（见 F001 决策） |

## Features 与 acceptance

### F001 · `AUTH_SECRET` 生产 fail-closed · executor: generator

运行时在生产缺 secret 时拒绝服务，构建期不受影响；部署 workflow 把该 secret 从 warning 升为硬失败。

**设计约束（源自上表最后一行）：** 判据不得只用 `NODE_ENV`。使用构建期信号（`process.env.NEXT_PHASE === "phase-production-build"`）或等价显式 build 开关放行构建；生产运行时缺失、空串、等于历史占位串 `dev-placeholder-set-AUTH_SECRET-in-production`、或长度不足 → 抛错。`AUTH_RESEND_KEY` / `HARNESS_CONSOLE_SIGNING_KEY` 保持 warning 语义不变（那两个是功能降级，本项是安全降级）。

acceptance：
1. 单测：构建期信号在场 + 无 `AUTH_SECRET` → **不抛**（构建可过）
2. 单测：生产运行时 × {缺失 / 空串 / 等于历史占位串 / 长度不足} 四种 → 抛，且错误信息不回显任何密钥内容
3. 单测：development 无 secret → 保持占位可用，本地 dev 不被打断
4. `npm run build` 实跑通过（机械证据：命令 + 退出码）
5. workflow：缺 `AUTH_SECRET` 的分支退出码 ≠ 0；另两把钥匙仍只 warning（diff 逐条对照）
6. `npm run verify` + 全量 test 绿

### F002 · `safeCallbackPath` 开放重定向封堵 · executor: generator

新增纯函数返回同源绝对路径，否则回落 `/`；`app/login/page.tsx:12` 改用。**刻意设计成可复用**——`BL-FRONTEND-REVIEW-REMAINDER` 的 F-03（登录后深链回跳）将直接消费同一 helper，本批不实现回跳本身。

acceptance：
1. 恶意向量表 ≥14 条全部回落 `/`：`https://evil.example` · `//evil.example` · `/\evil.example` · `\\evil.example` · `%2F%2Fevil.example` · `%5C%5Cevil.example` · `javascript:alert(1)` · `data:text/html,x` · `http:/evil` · `/\/evil.example` · 大小写变体 · 前后空白变体
2. 合法路径原样返回：`/` · `/models/abc` · `/devices/x?a=1#h`
3. 解码后二次判定不产生逃逸（对解码结果再过一遍同一判据）
4. grep 断言：`app/login/page.tsx` 无裸 `params.callbackUrl` 进 `redirect`
5. `npm run verify` + 全量 test 绿

### F003 · 图表 tooltip 存储型 XSS 封堵 · executor: generator

两处 `custom` tooltip 的全部动态插值走严格 HTML 实体转义（至少 `& < > " ' \``）。**渲染层转义是本项的安全防线**；输入侧约束只是纵深防御，其失败形状不得比它防的洞更贵。

**输入侧的分路径规则（首轮拒收后钉死，见硬约束第 4 条）：**
- `enroll`（交互式首次接触）：`device.name` 超长 / 含控制字符 → **硬拒收 400**，用户当场看到错误
- `batch ingest` 与 `heartbeat`（agent 上报热路径）：**只清洗不拒收**——`device.name` 截断到上限、剥除控制字符后入库；`source` 同样只做长度与控制字符清洗
- ❌ **不得**对 `source` 施加闭集枚举成员校验：`prisma/schema.prisma:182` 的 `source` 是自由字符串，`kimicode` 就是后加的；闭集会让「agent 先于服务端升级」这一寻常发布次序把该设备打成永久断流
- ❌ **不得**改动 `src/cli/**`。客户端校验在本威胁模型下不是安全边界——攻击者持设备 token 会直接打接口、绕过 CLI

acceptance：
1. 单测：`item.name = '<img src=x onerror=alert(1)>'` → 产出串不含未转义 `<`，含对应实体
2. 单测：同一 tooltip 内 date 与金额字段同样过转义（不得只护 name 一处）
3. grep 断言：涉及的 chart 文件中所有进入 template string 的动态值都经过 escape helper
4. 全仓扫描其他同类注入点（`custom:` tooltip / `dangerouslySetInnerHTML` / `innerHTML`）——有则一并修，无则在 commit 正文记录"扫描零命中"的机械输出
5. `enroll` 对 `device.name` 硬拒收，单测覆盖长度与控制字符边界
6. **毒丸回归测试（硬性）**：构造一条 `device.name` 超长且含控制字符、`source` 为未知值的上报批次，断言 `POST /api/usage/events/batch` 返回 **2xx**、事件已入库、且入库的 name 已被截断/清洗——即该批次**不会**触发 `src/cli/agent.ts` 的队列钉死路径
7. grep 断言：`src/cli/**` 与 `src/shared/agent-feature-version.ts` 零改动
8. `npm run verify` + 全量 test 绿

### F004 · Gate 决策数据库 CAS · executor: generator

落库改 `updateMany({ where: { id, userId, decisionAction: null, consumedAt: null } })` 并严格要求 `count === 1`，否则 409；签名生成可留在 CAS 之前（纯函数），但**签名结果只在 CAS 成功时可见**。

acceptance：
1. 并发实测：两个并发 approve → 恰一个 200、一个 409；DB 终态只有一份 `decisionSig`，且等于 200 响应所示
2. 已 `consumedAt` 的 gate → 409 且不覆盖既有字段
3. 已 `decisionAction` 的 gate → 409
4. 跨租户 id → 404（`userId` 必须留在 CAS 的 where 内）
5. `count !== 1` 时不得返回 `ok:true`
6. `npm run verify` + 全量 test 绿

### F005 · 订阅额度按 accountKey 分组 · executor: generator

`DISTINCT ON` 补 `accountKey`；聚合键从 `provider` 改为 `provider+accountKey`；每个账号一张卡，`capturedAt`/`capturedBy` 只在同一账号内取最大。补索引 `@@index([userId, provider, accountKey, windowKey, capturedAt])`（纯 additive migration）。

acceptance：
1. DB 探针：同一 user 两个 `accountKey` 各持不同 window → 每张卡的 windows **全部同 accountKey**，无跨账号拼接
2. `capturedAt` / `capturedBy` 取值不跨账号
3. 单账号场景与改造前逐字段等价（回归）
4. migration 在 scratch 库 `prisma migrate deploy` 干净重放（实跑证据）
5. i18n 双语补齐（账号标识展示）；多账号与单账号两种形态截图或渲染测试
6. `npm run verify` + 全量 test 绿

### F006 · 设备注册绑定本次 enrollment · executor: generator

按上表核查结论走**最小改动**路径：token 生成接口 additive 返回 `enrollmentId`；新增 `GET /api/admin/enrollment-tokens/[id]`（登录态 + 租户作用域 + `force-dynamic` + 不经 `unstable_cache`）返回 `{ usedAt, usedById, deviceName, expiresAt }`；客户端改为轮询该端点，成功判据 = `usedById` 非空，并加退避与 `AbortController`。

**`deviceName` 的授权与理由（2026-08-10 首轮拒收后追加）：** 首份 handoff 把成功卡片的显示名赋成了原始设备 id（`已连接:dev_9f2c8ab1…`），是本批引入的用户可见回归，且波及两个入口——`/devices` 模态与**首访引导卡**（`app/_components/onboarding-card.tsx:34` ← `app/page.tsx:96`），即新用户第一次连上机器看到的那句话。故授权端点 additive 返回 `deviceName`（按 `usedById` 关联 Device 取名，同一租户作用域内，无新增泄露面）。
❌ **不得**改用「成功后再拉 `/api/devices` 取名」：该路径经 `getDeviceSummary` 的 30s `unstable_cache`（`src/server/summaries.ts:1122`），刚注册完大概率命中注册前快照，取不到名反而回落成 id——等于绕一圈回到同一个 bug。

acceptance：
1. 端点四态：未登录 401 · 他人 enrollment 404 · 本人未使用 `{usedAt:null,usedById:null}` · 已使用返回本次 deviceId **与 deviceName**
2. 端点无缓存：实现不经 `unstable_cache` 且 `dynamic="force-dynamic"`（grep + 响应实测）
3. **回归用例直击 F-04 复现路径（硬性，首轮未兑现）**：必须是**行为级**断言，不接受 `readFileSync` + `toContain` 的源码字符串断言。仓库 vitest 为 node 环境无 jsdom，故把 claim 判定抽成可 import 的纯函数（入参为该 enrollment 的状态，出参为是否 claimed），断言「存在无关新设备但本 enrollment 的 `usedById` 仍为 null → 非成功」。**测试不得逐字钉死实现语句**（首轮 `tests/shared/enroll-flow-card.test.ts:10` 即以 `toContain` 钉死了含 bug 的那行，使修复必然翻红）
4. 轮询退避生效；组件卸载时 abort，无 setState-after-unmount 警告
5. token 生成响应新增 `enrollmentId` 且既有字段一字不改（老客户端兼容断言）
6. 成功卡片显示**人类可读设备名**，不得回退为设备 id；两个入口（`/devices` 模态与首访引导卡）行为一致
7. `EnrollFlowCard` 不再使用的 `initialDeviceIds` prop 一并清理（含 `add-device-section.tsx` / `onboarding-card.tsx` 两个调用方与 `app/page.tsx` / `app/devices/page.tsx` 的取值点）——该 prop 因本 feature 而失效，属本批产生的死重
8. `src/cli/**` 与 `src/shared/agent-feature-version.ts` 零改动；后者可直接引用既有 oracle `tests/server/agent-version.test.ts:23-24`（两常量钉死为 9）而非新写 grep 断言
9. `npm run verify` + 全量 test 绿（须在沙箱外复算；沙箱 EPERM 归因不构成证据）

### F007 · 批次成本查询放大治理 · executor: generator（源 BL-COST-PERF 的 F-32 分片）

三件，按风险从低到高：
- **(a) 封闭批次剔除时间入参：** 纯函数判定"全部区间已封闭"，封闭则以 sentinel 替代 `nowMs` 参与 cache key，使已 done 批次永久缓存；活跃批次维持 30s 量化窗口
- **(b) 关联查询设界：** `/projects/[id]` 的 `harnessProject.findMany` 加确定序 `orderBy` + `take` 上限，超限在 UI 披露
- **(c) 单查询聚合：** 以一条 range-join 查询（interval `VALUES` 列表）替代逐区间 `groupBy`，一次返回 `(intervalIdx, model, 四列 sum)`；**JS 侧定价与 unpriced 归集循环逐字不动**——只换取数形状，不换算术

acceptance：
1. 口径不漂移：改造前后同一 fixture 的 `BatchCost` **逐字段深比较相等**（含 `phases[]` / `unpricedComputeTokens` / `rework*` / `window*Iso`）
2. 查询计数探针：单批次聚合的 DB 往返从 `N_intervals` 降到 **1**（机械计数，不接受叙述）
3. 封闭批次跨 30s 窗口两次请求命中**同一** cache key；活跃批次仍按 30s 窗口换 key
4. `/projects/[id]` 关联数超上限时截断且 UI 显式披露；`take` 必须配确定 `orderBy`
5. 折入 F001 验收期的四条边界探针（乱序 transitions / 同毫秒 / 恰在开闭沿 / 时钟偏斜）进主套件并绿
6. 复用 `BL-COST-BATCH-V1` F004 审计 fixture 复算，结论不回归
7. `npm run verify` + 全量 test 绿

### F008 · 安全专项独立验收报告 · executor: evaluator

由 Evaluator（kimi）以**对抗输入实测**验收六个安全项，产出报告 `docs/test-reports/BL-SECURITY-P1-security-audit-2026-08-1X.md`。判据是"洞是否真的堵上"，不是"改动是否落地"。

acceptance：
1. 六个安全项各出一条**可复现**的攻击/滥用向量实测记录（含命令与实际输出）
2. F-01 负向面必须实测生产形态行为，**不得只读代码**
3. F-33 以真实并发两请求实测，记录两个响应码与 DB 终态
4. F-05 端到端：恶意 device name 从 enroll 一路到图表渲染
5. F-35 多账号 fixture 实测不混拼
6. F007 口径不回归的**独立**复算（不复用 Generator 的断言）
7. 报告入库并在 `progress.json` 落 `evaluator_feedback`

## 关键决策记录

- **F001 判据不用 `NODE_ENV`**：Dockerfile builder 阶段 `next build` 内部即置 `NODE_ENV=production`，用它做 fail-closed 判据会让镜像构建当场断裂。改用构建期信号区分，这是本批唯一一处「不照抄报告建议」的地方，理由见核查表。
- **F001 的爆炸半径与上线闸门**：`app/layout.tsx` 每请求调 `auth()`，生产缺 secret 时 fail-closed = 全站 500。这是**期望的**安全语义，但要求合并前确认生产已配置真实 `AUTH_SECRET`。**该确认是 F001 push 前的人类闸门**，不由 agent 代劳。
  → **2026-08-10 用户已确认生产 GitHub Secret 与 VPS `.env` 均已配置真实值**，F001 按规格实现并在本批末尾正常 push。
- **F006 走最小改动**：报告建议的"enroll 接口写入 enrollment id"经核查已实现（`usedById`），故本批零 schema、零协议、不 bump fv。这条是铁律 2「报告断言按线索处理」的直接收益。
- **F003 首轮拒收（2026-08-10）**：codex 首份 handoff 被 spec-lock critic 判 OUT_OF_SCOPE 并由 Coordinator 拒收，两条越界——① 改了 `src/cli/enroll.ts`（违反硬约束，且该处客户端校验在本威胁模型下无安全价值）；② 给 `source` 加了闭集枚举 + 整批 400，而 §F003 只授权「长度与控制字符约束」。② 经机械追链证实会造成**永久不自愈的单设备断流**（`sync.ts:51` 抛 → 2 次重试耗尽 → `agent.ts:65-67` 的 `clearQueue`/`writeCursor` 永不执行）。该发现反过来暴露规格自身的疏漏：**已授权的 device name 拒收也是同一毒丸形状**。用户裁决改为热路径清洗，并升为全批硬约束第 4 条。
- **F002 只做 helper 不做回跳**：深链回跳（F-03）留在 `BL-FRONTEND-REVIEW-REMAINDER`；本批只保证 helper 形状可被其直接复用。
- **F007 只取 F-32 分片**：`BL-COST-PERF` 的其余成员（F-07 整树 refresh / F-08 无界列表与缺索引 / F-29 重复扫描 / F-14 徽章轮询）留在原 backlog 条目，本批不动。
- **push 节奏**：F002/F003 → F004/F005/F006 → F007 → **F001 最后**（爆炸半径最大，且需人类确认生产 secret 后才推）。F008 报告不触发部署。

## 测试计划

- 基线：全量 1148 passed / 12 skipped（评审报告实测值）。本批新增用例只增不减，收尾须报出新基线数字。
- 新增分层：F002/F003 纯函数向量表（无 DB）· F004/F005/F006 需 DB 探针（scratch 库）· F007 口径深比较 + 查询计数探针 · F008 对抗输入实测。
- F005 的 migration 必须在 scratch 库实跑 `migrate deploy` 重放。
- 每条「已修 / 已验证 / 全绿」陈述都须有对应命令输出为据（铁律 13）。
