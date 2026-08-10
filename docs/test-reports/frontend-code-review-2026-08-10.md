# 前端全量 Code Review

> 审查日期：2026-08-10
> 锁定版本：`905a90b`
> 范围：`app/` App Router 页面、`src/components/` 共享 UI、被页面直接调用的 `src/server/` 数据/认证边界，以及前端构建与测试配置。认证和 API 问题仅在它们直接改变前端行为或安全边界时纳入。

## 结论

当前代码可以通过编译和现有单元测试，但不建议直接作为大租户和真实登录流的“无风险”版本发布。主要阻断项是：生产缺少 `AUTH_SECRET` 时使用公开固定密钥、登录 `callbackUrl` 外跳、设备注册成功状态可能误判、图表 tooltip 的存储型 XSS、gate 决策可被并发覆盖，以及批次成本/订阅额度存在财务数据正确性与查询放大问题。

按优先级统计：**P1 15 项，P2 22 项，P3 3 项，共 40 项**。P1 不是 lint 能发现的语法问题，而是需要行为、数据库和安全回归验证的问题。

## 验证基线

- `npm run verify`：通过（在移走 `.next` 的干净条件下复跑，退出码 0）。
- `npm run lint`：通过，无 warning/error；脚本仍使用已被 Next 标记为 deprecated 的 `next lint`。
- `npm run build`：通过，Next 15.5.18；本地构建输出 dashboard 首屏约 132KB、设备页约 131KB、Harness 详情约 136KB First Load JS；共享 chunk 中 ApexCharts 约 535KB 未压缩（约 139KB gzip）。
- `npm run test`：86 个测试文件通过、4 个文件跳过；1148 passed，12 skipped。
- 审查期间主分支从 `c27fb38` 推进到 `905a90b`；`b1e0368` 已修复原 F-31 中的 `done` 终态封闭、未定价 token 披露和同毫秒排序稳定性。本报告已在新基线复核，F-31 只保留尚未修复的失联窗口、截断和阶段改标问题，不将已修项计入 40 项。
- 仓库没有可执行的 Playwright/React Testing Library 前端回归套件；本次也未启用仓库 DB/contract probe，相关测试在 Vitest 中跳过。因此登录、轮询、tooltip 和并发写入的执行态结论来自完整源码链路与静态可复现推导，发布前仍需补 L2 E2E/DB 集成验证。

## Findings

### F-01 [P1] 生产缺少 `AUTH_SECRET` 时回退到公开固定密钥

- **证据**：`src/auth.ts:6-13` 在任何环境把缺失的 `AUTH_SECRET` 写成固定字符串；`.github/workflows/deploy-vps.yml:189-217` 只 warning，不阻止部署并把空值写入 `.env`。
- **影响/复现**：在未配置 secret 的生产实例上启动并访问 Auth.js 路由，实际使用的是仓库中可见的同一密钥。会话/CSRF 加密签名的安全边界退化，且多实例共享可预测密钥；代码注释所称“Auth.js 会拒绝真实 session”不能作为保证。
- **建议**：生产启动时对 `NODE_ENV=production` 做 fail-closed 校验（缺失、短或使用已知占位值直接退出）；部署 workflow 将 secret 缺失改为失败，并增加启动 smoke 断言。

### F-02 [P1] 登录 `callbackUrl` 未校验，存在开放重定向

- **证据**：`app/login/page.tsx:9-13` 直接执行 `redirect(params.callbackUrl ?? "/")`。
- **影响/复现**：已登录用户打开 `/login?callbackUrl=https://evil.example`（或 `//evil.example`）会被重定向到外部站点，可用于钓鱼和信任链绕过。
- **建议**：只接受同源绝对路径；拒绝 `//`、带 scheme 的 URL、反斜杠变体和编码后二次解析结果。统一使用一个 `safeCallbackPath` helper，并加单测/E2E。

### F-03 [P1] 受保护页面登录后丢失深链

- **证据**：`src/server/auth-session.ts:21-25,33-39` 无条件 `redirect("/login")`；`app/login/page.tsx:18-23` 的 server action 固定 `redirectTo: "/"`，没有把原始 pathname/search 传回。
- **影响/复现**：匿名访问 `/models/<id>`、`/devices/<id>` 或 `/harness/<id>`，完成 magic-link 后总回首页，用户需要重新寻找原页面；分享的深链在登录后不可恢复。
- **建议**：鉴权 helper 接收并编码 return path，登录页用已校验的 callback 传给 `signIn`；无 callback 时才回 `/`。为每类 detail route 增加登录回跳测试。

### F-04 [P1] 设备注册成功检测未绑定本次 enrollment，且轮询读到 30 秒缓存

- **证据**：`app/_components/enroll-flow-card.tsx:74-110` 只比较“当前设备列表中是否出现不在初始集合的任意 `deviceId`”；`app/api/admin/enrollment-tokens/route.ts:47-51` 没返回 enrollment id/目标设备标识；`app/api/devices/route.ts:6-10` 调用 30 秒 `unstable_cache` 的 `getDeviceSummary`（`src/server/summaries.ts:1121-1128`），即使客户端传 `cache: "no-store"` 也不能绕过函数缓存。
- **影响/复现**：用户 A 生成命令后，用户在另一终端或并发安装创建任意新设备，轮询会把它显示成“已连接”；首次轮询还可能把旧快照缓存 30 秒，实际目标设备已上线但 UI 长时间不确认。
- **建议**：token 生成接口返回 enrollment id，enroll 接口写入该 id 并提供按 enrollment 查询状态的轻量、不可缓存 endpoint；客户端按目标设备/token 轮询，并使用 AbortController/退避。

### F-05 [P1] 图表自定义 tooltip 直接拼接用户可控 HTML，形成存储型 XSS

- **证据**：`app/devices/daily-device-cost-chart.tsx:64-80` 将 `item.name` 插入 template string；`app/daily-source-chart.tsx:79-95` 将 `item.name` 同样插入；ApexCharts 的 custom tooltip 最终通过 `innerHTML` 写入（当前依赖 `node_modules/apexcharts/src/modules/tooltip/Tooltip.js:526`）。设备名来自 `app/api/devices/enroll/route.ts:47-64` / `src/server/ingest.ts:112-133`，没有内容/长度约束；source 在 JSON API 中也没有运行时 schema 校验。
- **影响/复现**：以设备 token 注册或上报名称 `<img src=x onerror=...>`，管理员在设备成本或 source 图表悬停时触发脚本。影响同租户管理员的同源会话和数据操作。
- **建议**：不要用 HTML template 展示动态值；优先使用 ApexCharts 默认 tooltip，或对文本做严格 HTML entity escaping（不能只替换 `<`）；同时对 device/source/model 字段做长度和字符集校验，并增加恶意值渲染测试。

### F-06 [P1] 根布局、页面和客户端 Provider 重复解析会话

- **证据**：`app/layout.tsx:21-27` 每个请求先 `auth()`；`app/session-provider.tsx:5-10` 明确不传 initial session，mount 后再请求 `/api/auth/session`；`src/server/auth-session.ts:21-27` 页面又调用 `auth()`。`/devices` 还在 `app/devices/page.tsx:75-81,128-132,145-149` 的三个 server section 各自调用 `requireSession()`。
- **影响/复现**：访问 `/devices` 或任意刷新，服务端至少重复做 root + page + 两个 section 的 session 查询，浏览器再发一次 `/api/auth/session`；Navbar 首次 hydration 可能先显示“登录”再闪变用户菜单，增加 TTFB 和数据库连接压力。
- **建议**：用 request-scoped `cache(auth)`/单一 `getRequestSession`，在页面向子 section 传 `tenantId`；把 server session 传入 `SessionProvider`，登录路由不要挂全局客户端 provider。

### F-07 [P1] 30 秒 `router.refresh()` 刷新整棵 RSC 树，放大全局查询和图表重渲染

- **证据**：`app/_components/auto-refresh.tsx:19-56` 前台每 30 秒、恢复可见时立即 `router.refresh()`；首页 `app/page.tsx:106-107`、设备页 `app/devices/page.tsx:85-86`、Harness 页 `app/harness/page.tsx:81-84` 都启用。`app/layout.tsx:24-27` 每次刷新还调用 `getAgentUpdateSummary`，`src/server/agent-version.ts:73-91` 对租户全部设备 `findMany` 并在 JS 中遍历。首页同一轮还独立请求 `getDailySummary/getDailyCost/getDailyBySource`（`app/page.tsx:284,345,360`）。
- **影响/复现**：打开多个 tab 90 秒，Network 会看到整页 RSC 请求；每次请求重新认证、扫描设备、重跑多个 aggregate，所有 ApexCharts 重新接收 options/series 并执行动画。缓存只覆盖部分 30 秒 summary，不能消除 auth、agent-version、冷缓存和失效瞬间的放大。
- **建议**：把实时状态拆成按需的轻量 endpoint/SWR，按可见区域刷新；或在服务端构造单一 dashboard loader 共享 Promise/快照，agent update summary 使用事件失效或短缓存，避免整树刷新。

### F-08 [P1] Harness/Devices 列表无界查询和渲染，且 gate 查询缺少匹配索引

- **证据**：`app/harness/page.tsx:44-64` 对 projects、未消费 gates 使用无 `take`/cursor 的 `findMany`，`109-159,178-315` 全量 map；`app/devices/page.tsx:145-149,182-227` 对所有设备渲染十列表格，且每行 `ClientStatusBadge` 都创建自己的 30 秒 `setInterval`（`app/_components/client-status-badge.tsx:28-33`）。`prisma/schema.prisma:456-459` 只有单列 `userId/decisionAt/consumedAt` 索引，而列表按 `userId+consumedAt` 过滤并按 `decisionAt,raisedAt` 排序（`app/harness/page.tsx:59-63`），徽章 count 还每 30 秒执行一次。
- **影响/复现**：给租户灌入数千历史项目、gate 或设备，首屏 RSC/HTML、数据库排序、DOM 和客户端定时器都会线性膨胀；`<details>` 仅折叠视觉，数据仍已查询和序列化，长期运行会导致 TTFB、内存和滚动交互恶化。
- **建议**：服务端 cursor 分页；历史项目按需展开后请求；设备表加入排序/分页或虚拟化；为常用 gate 条件设计复合/partial index，并用 `EXPLAIN (ANALYZE, BUFFERS)` 验证。

### F-09 [P1] “All” 的 KPI 与图表不是同一时间范围

- **证据**：`src/server/summaries.ts:21-32` 的 `rangeWhere("all")` 不设时间上限，KPI/ranking 聚合全历史；但 `daysForRange` 在 `878-882` 把 all 固定成 180，`getDailySummary/getDailyCost/getDailyBySource` 在 `914-926,965-978,1015-1025` 只查最近 180×24 小时并 zero-fill 180 个本地日期。UI 仍把选项和标题称为 “All time”（`app/_components/range-selector.tsx:29-32`, `messages/en.json:29`）。
- **影响/复现**：存在超过 180 天的历史事件时选择 All，卡片总数/成本包含全部历史，趋势图和 daily subtitle 只显示最近 180 天，用户会把两套数字当作同一口径。
- **建议**：明确命名为“最近 180 天”，或为 all 生成真实全历史的自适应 bucket；同时让标题、KPI、图表共享同一个时间窗口定义。

### F-24 [P1] 选择短时间范围后把历史账号误判为新账号

- **证据**：`app/page.tsx:77-99` 先按 URL 的 `range` 调 `getSummary`，随后仅以 `summary.eventCount === 0` 决定是否直接返回 `OnboardingCard`；真实的 `RangeSelector` 只在 `:104-122` 的正常 dashboard 分支中渲染。
- **影响/复现**：已有超过 7/30 天历史事件、但当前窗口没有事件的账号访问 `/?range=7d` 或 `30d`，会看到“连接第一台设备”的 onboarding，真实历史数据和范围选择器都消失，无法从该页面切回 All。
- **建议**：onboarding 判定使用 all-time 是否从未有事件/设备，或保留 range selector 并提供“此范围暂无数据”的空状态。

### F-25 [P1] 首次加载使用默认时区，PATCH 后当前页面不刷新

- **证据**：`app/_components/timezone-reporter.tsx:9-19` 只在 client mount 后 PATCH 浏览器时区；页面在 server render 前已通过 `getUserTimezone` 读取 `src/server/timezone.ts:4,17-31` 的默认 `Asia/Shanghai`（例如 `app/page.tsx:82-86`、`app/events/page.tsx:34-37`、`app/models/[model]/page.tsx:45-49`）。Reporter 成功后没有 `router.refresh()`。
- **影响/复现**：新用户在非上海时区首次打开 dashboard/events/model，SQL 分桶、标签和相对时间按上海计算；PATCH 虽写入正确时区，本次页面仍保留错误数据，必须二次导航/刷新才纠正。
- **建议**：在请求入口优先读取 cookie/客户端已知时区并传给 RSC，或 PATCH 成功后触发一次受控 refresh；同时避免首屏展示错误时区的数字。

### F-31 [P1] 批次成本仍会在失联非终态持续计费，截断/合并还会改写归因口径

- **证据**：`src/server/harness-cost.ts:107-113` 对任何非 `done` 的最后阶段都延长到 now，但 `getBatchCostImpl` 参数没有 `reportedAt`/新鲜度（`:176-181`），无法区分真正活跃与 agent 离线。Harness 详情和 Project 页仍只取最新 100 条 transition（`src/server/harness-detail.ts:82-98`, `app/projects/[id]/page.tsx:39-52`）；`TransitionLike`/页面映射仍丢弃 `observedAfter`（`src/server/harness-cost.ts:20-27`, `app/harness/[id]/page.tsx:53-60`），尽管 schema 明确真实切换发生在 `(observedAfter, observedAt]`（`prisma/schema.prisma:370-373`）。超过 60 区间时仍把最老区间并入后继但保留后继的 phase/fixRounds（`src/server/harness-cost.ts:116-120`），将旧阶段用量改标为后继阶段，扭曲阶段与返工小计。
- **影响/复现**：让 agent 停在 building/verifying 后离线，再产生同项目的其他用量，批次总额会每 30 秒继续上涨；超过 100 次流转会丢掉批次早期窗口，超过 60 区间则把 fixing/reverifying 等用量归到错误标签。当前文案披露 >100 截断，但没有解决或披露失联窗口和 >60 阶段改标。
- **建议**：用 report freshness/归档时刻封闭失联窗口；从当前批次边界查全量 transition，将 `observedAfter` 不确定性纳入边界策略；超限时预聚合同 phase/fixRound 或返回明确 partial，不要改写阶段标签；覆盖 stale、>60 语义和 >100 完整性测试。

### F-32 [P1] 批次成本按项目和阶段产生 `N × 60` 并发聚合，30 秒刷新持续换缓存键

- **证据**：`src/server/harness-cost.ts:124-193` 对每个 phase interval 发一次 `usageEvent.groupBy`，再用 `Promise.all`并发，上限 60 次。`app/projects/[id]/page.tsx:31-54,76-85` 对所有关联 HarnessProject 无界查询并再次 `Promise.all(getBatchCost)`。缓存参数包含量化后 `nowMs`（`src/server/harness-cost.ts:209-231`），Harness 详情还每 30 秒整页 refresh（`app/harness/[id]/page.tsx:71-74`），所以活跃批次的 key 每个 tick 都改变。
- **影响/复现**：一个 Project 关联 N 个长批次时，冷请求最多同时发起 `N × 60` 个 model groupBy；保持页面打开则每 30 秒重算当前窗口。这会在真实历史量下瞬时耗尽数据库连接/CPU，并放大 F-07。
- **建议**：使用单条 SQL（interval `VALUES`/range join + group）完成整批聚合；关联 HarnessProject 分页/限制；已封闭批次永久缓存，活动批次只增量刷新未封闭区间；为该页加数据库 query-budget 集成测试。

### F-33 [P1] Gate 批准/拒绝存在 TOCTOU，并发决策可覆盖已签名结果

- **证据**：`app/api/harness/gates/route.ts:73-84` 先读取 gate 并检查 `decisionAction/consumedAt`，签名后在 `:112-121` 仅按 `id` 做无条件 `update`，没有 transaction/CAS。
- **影响/复现**：两个标签页或两位操作者同时对同一 gate 提交 approve/reject，两请求都可在初始读阶段看到 null，都返回 200，后写入者覆盖先前已签名的一次性授权。客户端 busy 只能防单个组件重复点击，不能保护跨 tab/跨请求。
- **建议**：用 `updateMany({ where: { id, userId, decisionAction: null, consumedAt: null } })` 作数据库 CAS，严格要求 `count === 1`；签名与持久化纳入同一事务/锁语义，并用两个并发请求验证只有一个成功。

### F-35 [P1] 订阅额度“最新值”忽略 accountKey，可把多账号窗口拼成不存在的方案

- **证据**：`src/server/quota.ts:43-53` 用 `DISTINCT ON (provider, windowKey)` 选最新行，没有把 schema 中明确存在的 `accountKey`（`prisma/schema.prisma:233-251`）放入分组。随后 `:55-77` 只为每个 provider 建一张卡，使用首行的 accountKey，但其他 window 可来自不同账号/设备/采集时刻。
- **影响/复现**：用同一用户的两台设备分别上报两个 ChatGPT account，让 A 的 primary 更新、B 的 weekly/credit 更新，dashboard 会将它们显示成一个“最新”订阅卡；该 plan/rate/credit 组合实际不属于任何账号。
- **建议**：最新快照按 `provider+accountKey+windowKey` 选取，页面显式选择/展示账号；一张卡使用同一 account 且一致的 capturedAt/capturedBy 快照，补多设备多账号集成测试。

### F-10 [P2] 滚动时间下界与本地日历桶不一致，边界日数据会被截断

- **证据**：`src/server/summaries.ts:914-926,965-978,1015-1025,631-645,680-695` 用 `Date.now() - days*DAY_MS` 作为 SQL 下界；输出却用 `localDateRange`（`887-905`）从本地午夜开始生成日期。
- **影响/复现**：用户时区为 UTC+8、当前 08:00、选择 7d 时，最老显示日从本地 00:00 开始，但 SQL 只保留该日 08:00 之后；图表标签看起来是完整日，实际是半天，跨 DST/负时区也会出现类似偏差。
- **建议**：按时区把 `from` 截到显示首日的本地 00:00，或改成真正的 rolling-hour 视图并明确标签；为边界时刻和 DST 写固定测试。

### F-11 [P2] Model 时间范围 preset 后输入框保留旧值，Apply 会回滚数据；图表还可能多出终点桶

- **证据**：`app/models/[model]/model-range-picker.tsx:41-47` 只在首次 mount 初始化 `localFrom/localTo`；preset `:49-63` 只 `router.push`，不更新本地 state。服务端 `src/server/summaries.ts:595-603` 查询 `[from,to)`，但 `bucketKeys` `src/server/time-buckets.ts:112-125` 使用 `<= to` 生成桶。
- **影响/复现**：点击 Today/Yesterday/Last 24h 后，页面数据和 subtitle 已换新范围，datetime 输入仍显示旧范围；再点击 Apply 会把旧 URL 重新提交。若 `to` 恰好落在桶边界，查询不含终点而 chart 会渲染一个额外的空桶。
- **建议**：以 props/URL 为单一真源，导航成功后同步 local state；bucket 生成采用半开区间 `[from,to)`，并覆盖 preset/边界测试。

### F-12 [P2] 首屏立即加载全部 ApexCharts，below-fold 图表也参与 hydration

- **证据**：`app/page.tsx:180-198,722-725` 同时挂 daily charts、三张 sparkline；各图表和 `src/components/charts/{BarChart,LineChart}.tsx:1-18` 只把 `react-apexcharts` 改成 `ssr:false`，没有 viewport/IntersectionObserver 延迟。当前 build 的 Apex chunk 约 535KB raw（约 139KB gzip，见构建产物 `3975359d...js`）。
- **影响/复现**：低端设备打开首页即下载、执行并初始化多个图表实例，影响 LCP/INP；Suspense 只延迟 server data，不延迟 client library 和 hydration。
- **建议**：首屏先用固定尺寸的 server/SVG placeholder，进入 viewport 后才加载图表；合并 chart wrapper，稳定 memoize options/series，并用真实 Web Vitals/long task 数据设预算。

### F-13 [P2] Devices 页为拿初始 ID 额外执行一次完整 all-time 聚合

- **证据**：`app/devices/page.tsx:75-94` 只为 `AddDeviceSection` 的 `initialDeviceIds` 调 `getDeviceSummary(tenantId,"all")`；随后 `:128-132`、`:145-149` 又取 daily/table 数据。`src/server/summaries.ts:174-204` 的 summary 至少两次 `usageEvent.groupBy` 加一次全量 `device.findMany`，cache key 中 all 与当前 range 分离（`1121-1128`）。
- **影响/复现**：冷缓存访问 `/devices?range=7d` 会先扫描全历史 events，再执行 7d 统计；注册弹窗实际只需要设备 ID，TTFB/DB CPU 随历史增长。
- **建议**：单独提供 `findMany({select:{id:true}})` 的轻量快照，或让设备列表 loader 同时返回 ID；不要为 UI 初始化调用全量统计。

### F-14 [P2] 全局待批徽章后台持续轮询，并与 Harness 页重复查询；timezone 每次挂载无条件写库

- **证据**：`app/_components/pending-gates-badge.tsx:17-35` 不检查 `visibilityState`、无 in-flight guard；Navbar 在所有路由挂载（`src/components/navbar/index.tsx:82`）。Harness 自己每 30 秒刷新完整列表（`app/harness/page.tsx:81-84`）。`app/_components/timezone-reporter.tsx:9-19` 每次 AdminShell mount 都 PATCH，`src/server/timezone.ts:38-43` 无 compare-and-update。
- **影响/复现**：切换到后台或打开多个 tab 仍每 30 秒发 auth+count 请求；在 `/harness` 与整页查询重叠。页面导航/刷新还会产生无意义的 User UPDATE 和写放大。
- **建议**：可见性/退避/AbortController/in-flight 锁；仅在 Harness 路由启用徽章或共享已有 count；客户端缓存已上报 timezone，服务端只在值变化时更新。

### F-15 [P2] Pricing Scan 网络异常会产生未处理 Promise，界面没有稳定错误态

- **证据**：`app/admin/pricing/pricing-actions.tsx:134-165` 的 `ScanButton.scan` 在 `start(async () => { ... fetch ... })` 内没有 `try/catch/finally`；`fetch` reject 时只会留下 unhandled rejection，未设置 `message`。
- **影响/复现**：断网、代理拒绝或请求被浏览器取消时点击 Scan now，按钮可能恢复但页面不告诉用户是否执行，控制台出现未处理 Promise。
- **建议**：统一 `runAsync` helper，显式 loading/error/success 状态，在 `finally` 收尾；错误消息走翻译键并加网络失败测试。

### F-16 [P2] Magic-link provider 缺失时注释承诺的 Configuration 错误不会显示

- **证据**：`app/login/page.tsx:15-23` 注释称 provider 缺失会回到 `?error=Configuration`，但 server action 没有 catch；`src/auth.ts:38-49` 在无 `AUTH_RESEND_KEY` 时 providers 为空。
- **影响/复现**：未配置邮件 key 时提交登录表单，`signIn("resend")` 直接抛 server-action 异常，用户落到通用错误页而不是可翻译的登录错误/修复提示。
- **建议**：在配置缺失时在 action 前置返回明确状态，或 catch `signIn` 错误并 redirect 到带编码 error 的登录页；加入无 provider 的集成测试。

### F-17 [P2] 缺少路由级 loading/error 边界，远程失败时只有通用错误页

- **证据**：`app/` 只有 `app/harness/[id]/not-found.tsx`，没有全局或主要路由的 `loading.tsx`、`error.tsx`、`global-error.tsx`。页面中的 Suspense（如 `app/page.tsx:138-198`）只处理 loading，不捕获 server exception。
- **影响/复现**：数据库短暂不可用、pricing/quota 查询超时或 RSC 刷新失败时，用户没有可重试、保留旧数据或说明故障的界面；不同页面行为不一致。
- **建议**：根布局和高流量 route 增加可翻译 error boundary + retry，loading 与数据卡片保持稳定尺寸；对独立 section 使用 error boundary，避免一块故障拖垮整页。

### F-18 [P2] 空状态和明细列表能力不完整，部分数据被静默截断

- **证据**：`app/events/page.tsx:79-118` 无事件时输出空 `<tbody>`；`app/devices/page.tsx:181-228`、`app/projects/[id]/page.tsx:160-172`、`app/models/[model]/page.tsx:351-360` 同样没有空行/说明。`src/server/summaries.ts:255,413,800` 将 detail 最近事件固定 `take:100`，页面没有“最近 100 条”提示或下一页。
- **影响/复现**：新租户或无数据筛选结果显示一块空白表格，用户无法区分“暂无数据/加载失败”；有数千事件时明细总数与可见记录不一致且无法继续查看。
- **建议**：统一 EmptyState（含下一步行动）；明确 recent limit，并增加 cursor pagination/导出或至少“显示最近 N 条”文案。

### F-19 [P2] 多处控件不满足键盘/读屏语义

- **证据**：移动侧栏关闭是 `<span onClick>`（`src/components/sidebar/index.tsx:16-21`），闭合仅做 transform，没有 `inert`/`aria-hidden`；`AdminShell` 的 open state 不会随 pathname 改变（`app/admin-shell.tsx:19-35`），导航链接也不调 `setOpen`（`src/components/sidebar/components/Links.tsx:23-64`）。闸门 note 和定价四个价格输入只有 placeholder（`app/harness/gate-actions.tsx:52-60`, `app/admin/pricing/pricing-actions.tsx:54-62`）；登录错误没有 `role="alert"`（`app/login/page.tsx:31-36`）；模式编辑把 `<legend>` 放进 `<div>`（`app/harness/[id]/mode-editor.tsx:362-366`）。Harness 决策徽章将 approve/reject 都渲染为绿色（`app/harness/page.tsx:136-149`），关键结果无法通过颜色扫描区分。
- **影响/复现**：在移动宽度打开菜单并点击新路由，抽屉继续覆盖新页；关闭后隐藏链接仍可被 Tab 聚焦。同时键盘/读屏用户无法可靠关闭导航、识别表单字段或及时获知失败；拒绝决策还被视觉编码成成功。
- **建议**：抽屉使用有 focus trap/恢复的 dialog 语义，关闭态加 `inert`，链接跳转/pathname 改变自动关闭；使用 `<button aria-label>`、显式 `<label htmlFor>`、`role="alert"/aria-live` 和合法 `fieldset > legend`；reject 使用独立图标+语义色；补 axe/键盘 E2E。

### F-20 [P2] locale 切换只覆盖 message key，业务 UI 仍混杂中英文且数字固定 en-US

- **证据**：`app/_components/onboarding-card.tsx:19-31`、`app/_components/enroll-flow-card.tsx:99,125-221` 固定中文；`app/admin/pricing/page.tsx:44-113`、`app/admin/pricing/pricing-actions.tsx:78-165` 固定英文；`src/components/navbar/index.tsx:76,97-164` 混合中英文 aria/菜单；`src/shared/format.ts:44-46` 和 `app/events/page.tsx:22-24` 固定 `en-US`。更直接的数据口径错误是 `messages/{en,zh-CN}.json:42,46,62` 在图表 subtitle 硬编码 `Asia/Shanghai`，而服务端已按用户时区分桶。
- **影响/复现**：切到 English 后首页 onboarding/设备注册仍显示中文，切到中文后 admin pricing 仍全英文，数字格式也不随 locale 变化。非上海时区用户看到的数据是按自己时区聚合，文案却声称按上海时区，产生可观测的口径矛盾。
- **建议**：所有可见文案、aria-label、状态值和数字 formatter 统一走 next-intl；对两套 locale 做 key parity 和页面 snapshot。

### F-21 [P2] 全局 CSS/字体重复注入并把完整 messages payload 发给每个客户端页面

- **证据**：`app/layout.tsx:1-5` 全局导入五份 CSS；`src/styles/index.css:1-2`、`src/styles/App.css:1`、`src/styles/MiniCalendar.css:1` 重复 Google Fonts `@import`，还把未使用的 legacy calendar/template 样式注入所有路由；`app/layout.tsx:22-23,40-42` 将约 31–32KB 的完整 `messages/*.json` 传给 `NextIntlClientProvider`。根 `<html>` 没有服务端初始 dark class，Navbar 只在 hydration 后从 localStorage/system preference 加 class（`src/components/navbar/index.tsx:22-34`）。
- **影响/复现**：首屏依赖外部字体 DNS/TLS/CSS，可能 FOIT/FOUT；重复样式和全量翻译增加 CSS/HTML/序列化成本。存储为暗色或系统偏好暗色的用户每次 hard reload 都会先看到亮色首屏再闪变。
- **建议**：用 `next/font` 自托管/子集化，按路由加载 legacy CSS；按 namespace 拆 messages 或只在需要 client translation 的边界传递；用 cookie+服务端 class 或在样式绘制前执行的最小 theme bootstrap 消除闪烁。

### F-26 [P2] Model 自定义时间范围没有最大跨度限制

- **证据**：`app/models/[model]/model-range-picker.tsx:73-94` 的 `datetime-local` 没有 `min/max` 或跨度校验；`app/models/[model]/page.tsx:53-69` 接受任意 finite `from/to`；`src/server/time-buckets.ts:115-125` 只把 bucket 数上限设为 10,000。
- **影响/复现**：构造 `?from=1900-01-01T00:00&to=2100-01-01T00:00` 会触发全范围 aggregate 和最多 10,000 个 bucket，单个请求可长时间占用 DB/CPU，并把大 RSC payload 发给浏览器。
- **建议**：服务端限制最大跨度（例如 365/730 天），超限返回可翻译校验错误；同时给输入设置合理 min/max 和按跨度分页/周粒度策略。

### F-27 [P2] 多个详情页表格在移动端没有横向滚动容器

- **证据**：`app/projects/[id]/page.tsx:83-143`、`app/models/[model]/page.tsx:199-337`、`app/devices/[id]/page.tsx:272-354` 的 breakdown 表直接放在 Card 内；只有部分 recent-events 表包了 `overflow-x-auto`。
- **影响/复现**：390px viewport 加上长 model/project/device 名时，表格撑破卡片和页面宽度，出现横向溢出或列被挤压，详情页扫描/点击困难。
- **建议**：所有宽表统一 `overflow-x-auto` + `min-w`，或在移动端切换为 stacked list；用 320/390/768px 快照验证。

### F-28 [P2] Apex 图表没有读屏可替代内容

- **证据**：`app/daily-usage-chart.tsx:130-143`、`app/daily-cost-chart.tsx:72-85`、`app/daily-source-chart.tsx:99-113`、`app/devices/daily-device-cost-chart.tsx:85-99` 直接渲染 Apex；`src/components/charts/{BarChart,LineChart}.tsx:8-19` 没有 `aria-label`、summary 或隐藏数据表。
- **影响/复现**：键盘/读屏用户只能看到空的图表容器，无法获得趋势、成本或 source/device 数值，核心指标不可访问。
- **建议**：每图提供可翻译的摘要和可展开数据表（或 `role="img"` 的准确 label），图表失败时仍显示表格数据。

### F-29 [P2] 详情页 uncached 聚合重复扫描相同数据

- **证据**：`src/server/summaries.ts:245-293` 的 `getDeviceDetail`、`:792-824` 的 `getProjectDetail` 同时执行 `modelCostRows` 和 `costForWhere`（后者再次按 model groupBy），并查询 events/多个 breakdown；注释 `:1100-1105` 明确 detail 不缓存。`app/devices/[id]/page.tsx:86-90,126-127` 还挂了 30 秒 AutoRefresh。
- **影响/复现**：大租户反复打开或保持 detail 页面，会对同一范围重复 groupBy/成本计算，刷新周期进一步放大 DB CPU 和 RSC 延迟。
- **建议**：合并同一 groupBy 结果，select 仅需字段；对 immutable 时间窗口做短 TTL/标签缓存，detail 只刷新实时状态而非全量重算。

### F-30 [P2] Events 分页后 subtitle 仍写“Latest N”，误导当前页

- **证据**：`app/events/page.tsx:56-59` 无论是否带 cursor 都传 `t("events.subtitle", { count: events.length })`；`messages/en.json:131`/中文对应文案固定为 “Latest … raw usage events”。
- **影响/复现**：点击 Older 后页面仍标为 Latest 200，用户无法判断当前是历史页，也无法正确理解列表范围。
- **建议**：区分 first-page/older-page 文案，或显示游标页的时间范围和“第 N 页”。

### F-34 [P2] Git-only 项目排名在全局 Top 40 之后才过滤，可丢失合法结果

- **证据**：`src/server/summaries.ts:728-745` 先按所有项目 `totalTokens` 取 Top 40，`:759-786` 再查项目元数据并执行 `filter === "gitOnly"`，最后 `:787` 截成 20。同时 cost groupBy 在 `:741-745` 对全部 project×model 扫描，尽管 UI 最多返回 20 行。
- **影响/复现**：创建 40 个无 repoKey 的高用量本地项目，再创建排名 41 以后的 Git 项目，选 Git-only 会得到空/不完整列表，而不是 Git 项目自身的 Top 20。
- **建议**：在 top-K 之前通过 join/subquery 把 `repoKey` 条件下推到 SQL，只对候选项目聚合成本；用 >40 个混合项目的 fixture 固定排名语义。

### F-36 [P2] Quota 采集失败/授权失效不会到达 UI，且该请求绕过代理感知 fetch

- **证据**：`src/quota/run.ts:29-59` 只把 `quotaAuthErrors` 和 refresh status 写进 agent 本地 state；`src/server/quota.ts:42-80` 只读已入库 snapshot，`app/_components/subscription-card.tsx:8-17,45-90` 没有 provider error/disconnected/stale 状态。`src/quota/codex-chatgpt.ts:58-61` 还直接调原生 `fetch`，不走 CLI 其他同步链使用的 proxy-aware `agentFetch`；200 但空/畸形 JSON 在 `:69-73,85-136` 可映射为 0 条 snapshot 且无 error。
- **影响/复现**：让 token 失效、仅在代理环境运行，或返回 `{}`：agent 本地知道失败，dashboard 却可以无限期显示旧额度和“已连接”视图，用户不知道需要重新登录/修复网络。
- **建议**：把 provider health（last success/error/failure count/stale）纳入心跳或 quota 协议，校验非空响应契约；复用 `agentFetch`，重复失败退避；卡片显示旧数据年龄、错误和重连 CTA。

### F-37 [P2] QuotaSnapshot 持续追加，“最新窗口”查询会随运行时间无界增长

- **证据**：agent 在活跃/空闲时每 60/300 秒刷新（`src/cli/agent.ts:189-190,239-247`），每次对多个 window `createMany`；`QuotaSnapshot` 只追加，无 retention/rollup/current 表。`src/server/quota.ts:43-53` 在每次 30 秒缓存 miss 上对该用户全部历史做 `DISTINCT ON ... ORDER BY capturedAt DESC`，索引 `prisma/schema.prisma:251` 也没有 accountKey 和明确的 DESC 覆盖设计。
- **影响/复现**：单设备一年可积累数百万窗口行，首页定期查“最新几条”的延迟、磁盘读和索引体积持续上升。
- **建议**：将当前态 upsert 到独立 latest 表/物化视图，历史表实施 retention+降频 rollup；为 `userId,provider,accountKey,windowKey,capturedAt DESC` 做覆盖索引，用 `EXPLAIN` 和长期 soak 数据验证。

### F-38 [P2] Quota 批量入库 API 缺少运行时 schema 和负载上限

- **证据**：`app/api/quota/snapshots/batch/route.ts:27-55` 只验证 body 存在且 `snapshots` 是数组，随后直接 TS cast；没有 batch/body 上限、字符串长度、provider/window 枚举、finite/安全整数、`utilization` 0..1、日期有效性或 raw JSON 体积检查。`SubscriptionCard` 在 `:99-119` 只给 remaining 设下限，没有上限。
- **影响/复现**：持有合法设备 token 的客户端发送 `NaN`/超大整数/无效日期/巨大数组，Decimal/BigInt/Date/createMany 可让整批 500 或占用过量资源；负 utilization 还会渲染 >100% 宽的进度条。
- **建议**：用 Zod/等价 runtime schema，设置 body/batch/字段/rawJson 上限，对非法行稳定返回 4xx；UI 再防御性 clamp 到 0..100，补奇异值和超限合约测试。

### F-39 [P2] 订阅卡相对时间重复后缀，未来重置和窗口时长文案也错误

- **证据**：`formatRelativeTime` 已返回“5 minutes ago/5 分钟前”（`src/shared/format.ts:98-117`），`app/_components/subscription-card.tsx:86-90` 又把它传给带 `ago/前` 的 `messages/{en,zh-CN}.json:444-446`，实际输出“ago ago/前前”。重置时间也调同一个只面向过去的 formatter（`SubscriptionCard:111-114`），未来值被格式化为绝对日期而非倒计时。文案又硬编码 Code Review primary 为 5h（`messages/*:435`），但已有 fixture 的 `window_minutes` 是 60（`tests/fixtures/codex-chatgpt-response.json:20-25`）。
- **影响/复现**：打开有 quota 数据的首页，footer 直接出现重复语法；“X 后重置/resets in X”显示日期字符串，且 1h 窗口被标为 5h，用户会误判剩余时间。
- **建议**：分开 past/future formatter（可用 `Intl.RelativeTimeFormat`），相对值不再包一层后缀；把 `window_minutes` 结构化传到 UI 并动态生成 label；覆盖 en/zh、1h/5h/weekly 和过去/未来测试。

### F-22 [P3] 类型安全和依赖边界仍是模板式，降低重构可验证性

- **证据**：`tsconfig.json:5-9` 开启 `allowJs`、`strict:false`、`noImplicitAny:false`、`strictNullChecks:false`；通用图表/Card/导航 props 使用 `any`（如 `src/components/charts/BarChart.tsx:8-9`, `src/components/card/index.tsx`）；Chakra、TanStack Table、framer-motion、react-calendar、recharts 等主要只在未引用的 legacy 组件中出现。
- **影响**：API/组件契约错误只能在运行时暴露，清理模板依赖或升级 Next/React 时难以安全判断实际影响；无谓依赖增加安装、审计和维护面。
- **建议**：按目录渐进启用 strict，先收紧共享组件和 server/client 边界；用 bundle analyzer/npm ls 验证后移除 dead legacy 入口和依赖；把 `next lint` 迁移到 ESLint CLI 以适配 Next 16。

### F-23 [P3] 前端行为回归测试缺口大

- **证据**：`tests/` 目前主要覆盖 parser、CLI、server/shared 单元，没有 React Testing Library、Playwright 或 axe 测试。
- **缺失场景**：登录深链/open redirect、enrollment 并发误判和 30 秒缓存、model preset/Apply、Scan 网络失败、空状态/分页、locale parity、键盘导航和 tooltip 注入。
- **建议**：先建立 Playwright smoke（登录、首页 range、设备注册、模型 detail、Harness gate），再加 axe/键盘矩阵；将 DB fixture 与外部邮件/定价服务 mock 隔离，纳入 CI。

### F-40 [P3] 订阅额度功能只实现 Codex provider，已支持的其他 CLI 缺少对应卡片

- **证据**：`src/quota/registry.ts:4-6` 生产 provider 列表只有 `codexChatgptProvider`，`app/_components/subscription-card.tsx:8-17,45-84` 也只读/渲染 `codex-chatgpt`。仓库自身路线图已明确记录“quota 仅 1 provider”以及 Claude/Kimi 订阅窗口缺失（`docs/analysis/2026-08-08-repo-strategy/appendix/roadmap.md:17,58,122`）。
- **功能缺失**：已经通过 parser 支持 Claude Code/Kimi 等 source 的用户，首页仍无法查看对应订阅额度；也没有 provider/account 选择器或通用错误态。
- **建议**：将采集、health、account/window 结构和卡片 renderer 定义为 provider plugin contract，根据产品范围优先实现 Claude/Kimi；用同一组 contract tests 验证多 provider/多 account 并存。

## 建议的修复顺序

1. 立即处理 F-01～F-05、F-24～F-25、F-31、F-33、F-35：先关闭认证/XSS/决策竞态风险，停止展示不可靠的批次成本和跨账号 quota，再补 fail-closed、并发和财务口径回归。
2. 处理 F-06～F-09、F-32、F-34、F-37：合并 request session/dashboard loader，拆分整树刷新，实施分页/索引/单查询批次聚合，给热路径设置 query budget。
3. 处理 F-10～F-21、F-26～F-30、F-36、F-38～F-39：完成日期语义、错误/空/失联状态、输入校验、响应式、可访问性和 i18n，补关键用户路径 E2E。
4. 处理 F-22～F-23、F-40：渐进 strict，清理 legacy 依赖/资源，建立浏览器测试基线和可扩展 quota provider/account 契约。

## 保留项

现有 `npm run verify`、`lint`、`build` 和全量 Vitest 均通过，租户条件查询和事件主列表 cursor 分页已有基础实现；这些通过项不能抵消上述运行时和大数据量问题，但可作为修复后的回归基线。
