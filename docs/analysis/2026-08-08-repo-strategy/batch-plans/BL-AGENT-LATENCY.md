# BL-AGENT-LATENCY 落地方案

## 目标

把「人批准闸门 → 机器拿到决策」的最坏延迟从 15 分钟（cron fallback）压到 ≤2 分钟，把 daemon 轮询从「固定 60s 无退避」升级为错误驱动退避+抖动（失败时不再每分钟重撞服务端）；顺带修 enroll 首装不走自愈 fetch 的行为不一致，并补齐 /events 页 cursor 分页。**整批不动 agent↔服务端协议**，以 agent release 1.3.0 账本条目作为 rollout 载体。

## 范围（In / Out）

**In：**
- cron fallback 的 crontab 拆双条目（`run` 保持 syncMinutes；`harness` 单独每 2 分钟）
- daemon 模式 harness 节拍的错误驱动指数退避 + 抖动（复用已有 retryable 分类）
- `enroll.ts` 从全局 `fetch` 切到自愈 `agentFetch`
- `/events` 页 `occurredAt+id` 复合游标分页（索引已备，无 migration）
- `agent-releases.json` 追加 1.3.0 条目（rollout 触发器：控制台对 behind 设备显示升级提示）

**Out（刻意不做）：**
- **install.sh 锁 tag + sha 校验、`--purge` 卸载、凭据轮换** → 留给 BL-AGENT-SUPPLY-CHAIN（中期）；本批 rollout 仍走既有 `checkout origin/main` 链路
- **`src/quota/codex-chatgpt.ts:58` 的裸 `fetch`**（实地核对发现的另一处不走 agentFetch，但目标是第三方 ChatGPT 端点而非本服务端）→ 留给 BL-QUOTA-PROVIDERS 或后续健壮性批次，本批只修 enroll
- **推送通道（SSE/WebSocket）** → 远期 P4；本批只优化轮询
- **harness 项目发现只扫一层子目录**（cliagent 短板 6）→ 不在本批
- **agent.log 无轮转** → 本批新增 cron 条目会刻意把 stdout 丢 /dev/null 以不加剧该问题，日志轮转本身不做

## Features 预案

### F001 · cron fallback 拆双 crontab 条目 · executor: generator
**涉及文件：** `src/cli/service.ts`（`installCron` 156-169 行、`uninstallService` 171-194 行、`serviceStatus` 196-208 行）；新增 `tests/cli/service-cron.test.ts`

设计要点：
- 把 crontab 内容生成提炼为纯函数（如 `buildCronContent(current: string, opts)`），shell-out 保持薄壳，便于单测
- 双条目：`*/${syncMinutes} * * * * ${binPath} run >> ${logPath} 2>&1`（不变）+ `*/2 * * * * ${binPath} harness --json >/dev/null 2>> ${logPath}`（`tokenizer harness --json` 已存在，见 `src/cli/harness-command.ts:73-77`；stdout 丢弃因健康快照已落 `state.json.harness` 并随 heartbeat 上行）
- 旧行过滤：现有 filter 只匹配 `"tokenizer run"`（service.ts:164、187），须改为按 `binPath` 匹配以同时清掉旧单条目与新双条目，保证升级/卸载幂等

acceptance：
1. `npx vitest run tests/cli/service-cron.test.ts` 全绿：空 crontab / 已有旧单条目 / 已有双条目 / 混有用户无关行 四种输入下，输出恰含两条 tokenizer 条目且用户行原样保留
2. 纯函数输出中 harness 条目周期为 `*/2`，run 条目周期仍为 `*/${syncMinutes}`
3. `uninstallService` 对含双条目的 crontab 产出零条 tokenizer 行（单测断言）
4. 重复执行 `installCron` 两次，输出与执行一次相同（幂等，单测断言）

### F002 · harness 轮询错误驱动退避 + 抖动 · executor: generator
**涉及文件：** `src/cli/agent.ts`（tick 调度器 187-238 行，`HARNESS_MS` 190 行）；新增 `src/cli/harness-backoff.ts`；新增 `tests/cli/harness-backoff.test.ts`；`tests/cli/agent-lifecycle.test.ts`（是否需适配未核，视 agent.ts 内部提炼幅度）

设计要点：
- 新纯函数模块 `harness-backoff.ts`：输入上一轮 `HarnessSyncResult`（`issues[].retryable` 分类已有，harness.ts:87-119 / 613-626）与连续失败轮数，输出下次延迟：清洁轮 → 复位 60s；有 issue → `min(60s × 2^n, 600s)`，乘 0.85–1.15 均匀抖动；random 以参数注入保证可测
- agent.ts tick 中把 `now - lastHarnessAt >= HARNESS_MS` 的固定阈值换成动态 `nextHarnessDelayMs`，单飞逻辑（`harnessInFlight`）不动
- cron 模式（`runOnce`，agent.ts:94-98）节拍由 crontab 决定，不引入退避

acceptance：
1. `npx vitest run tests/cli/harness-backoff.test.ts` 全绿：成功复位、连续失败 1/2/3/4 轮延迟为 120/240/480/600s（抖动注入固定 random 后精确断言）、600s 封顶、抖动边界 [0.85, 1.15]
2. 全部 issue 为 `retryable:false` 时同样退避（不再每 60s 重撞，单测断言）
3. `npx vitest run tests/cli/agent-lifecycle.test.ts` 保持全绿（回归）
4. `npm run verify` 通过（tsc）

### F003 · enroll 切换 agentFetch · executor: generator
**涉及文件：** `src/cli/enroll.ts`（34 行，全局 `fetch` → `agentFetch`）；`src/cli/fetch.ts`（只引用不改，agentFetch 见 45-63 行）；新增 `tests/cli/enroll.test.ts`

acceptance：
1. `grep -n "await fetch(" src/cli/enroll.ts` 零命中；`grep -n "agentFetch" src/cli/enroll.ts` 命中 import 与调用
2. `npx vitest run tests/cli/enroll.test.ts` 全绿：vi.mock `@/cli/fetch` 后断言 `enrollDevice` 经 agentFetch 发出 POST `/api/devices/enroll` 且 body 含 enrollToken/device；非 2xx 时抛错并不写 credentials
3. `src/cli/` 与 `src/quota/sync.ts` 范围内指向本服务端的网络调用无裸 `fetch`（`grep -rn "await fetch(" src/cli/` 仅允许零命中）

### F004 · /events cursor 分页 · executor: generator
**涉及文件：** `app/events/page.tsx`（26-31 行固定 `take:200` 改造）；新增 `src/server/events-cursor.ts`（游标编解码 + where 构造纯函数）；`messages/en.json`、`messages/zh-CN.json`（新增 `events.pagination.*` 键）；新增 `tests/server/events-cursor.test.ts`

设计要点：
- 游标 = `${occurredAt.toISOString()}_${id}`（UTC ISO，硬约束 2；id 为 cuid 字符串，schema.prisma:177）；页面读 `searchParams.cursor`，查询条件 `occurredAt < c OR (occurredAt = c AND id < cid)`，`orderBy [{occurredAt: desc}, {id: desc}]`，`take: 201` 探测是否有下一页
- 走既有 `@@index([userId, occurredAt])`（schema.prisma:218），同毫秒簇内 id 过滤代价可忽略；无新索引、无 migration
- 非法/篡改 cursor 解码失败 → 静默回退第一页，不 500
- UI：底部「更旧 / 回到最新」链接（服务端组件 + Link href 带 cursor，沿用 `app/page.tsx:77-78` 的 searchParams 模式）

acceptance：
1. `npx vitest run tests/server/events-cursor.test.ts` 全绿：编解码往返、非法输入返回 null、同 occurredAt 不同 id 的排序/过滤正确性
2. 本地起 dev（或 build 后）访问 `/events`：>200 条数据时出现「更旧」链接，点击后 URL 带 cursor、内容无重复无遗漏（人工/E2E 断言首尾事件 id 不重叠）
3. 带垃圾 `?cursor=xxx` 访问返回 200 且渲染第一页
4. `npm run lint` 与 `npm run verify` 通过；两个 messages 文件键集合一致

### F005 · agent release 1.3.0 账本 + rollout · executor: generator
**涉及文件：** `src/shared/agent-releases.json`（末尾追加 1.3.0 条目，`agent_feature_version` 保持 9）；`src/shared/agent-release-version.ts`、`src/shared/agent-feature-version.ts`（均只读不改，用于断言）

acceptance：
1. `LATEST_AGENT_RELEASE.version === "1.3.0"` 且 `agentReleaseStanding("1.2.1").kind === "behind"`（单测或 node -e 断言）
2. `AGENT_FEATURE_VERSION === 9 && MIN_AGENT_FEATURE_VERSION === 9` 保持不变（grep 断言，硬约束 3）
3. 1.3.0 条目含 zh-CN/en highlights 各 ≥2 条（双条目 cron、退避、enroll 自愈）
4. `npm run test` 全量绿——特别覆盖 `tests/server/harness-report-mode-intent.test.ts` 与 `tests/evaluator/bl-agent-release-acceptance.test.ts` 中硬编码 "1.2.1" 的用例（实地核对均为「任意合法 semver」语义、不与 latest 比较，预期不受影响；以全量跑通为准）

## 数据模型 / migration

**无。** F004 复用既有 `@@index([userId, occurredAt])`（prisma/schema.prisma:218）；无表/列/索引变更。

## API 与协议影响

- **零协议变更**：无新增/修改 endpoint；`/api/devices/enroll`、`/api/harness/*` 的请求/响应形状不动；harness 身份头 `x-tokenizer-agent-release-version` 只是值从 "1.2.1" 变 "1.3.0"，服务端按通用 semver 解析（`src/shared/agent-release-version.ts:36-48`），无兼容分支
- **AGENT_FEATURE_VERSION 不 bump（保持 9）**：本批全部是行为优化与体验补齐，无「服务端必须要求 agent 具备」的新能力；旧 agent 完全可用，只是慢。符合「纯 bug 修复/优化不动」规则（硬约束 3）
- **rollout 机制**：追加 release 账本 → 服务端部署后 `deviceAgentUpdateStatus`（src/server/agent-version.ts:54-60，实地核对：`standing.kind === "behind"` → `upgrade-required`）对全部存量设备亮升级提示 → 用户重跑 `curl … install.sh | bash`（stop 旧进程 → `checkout origin/main` → `install-service` 重写 crontab 双条目，public/install.sh:229-278）。cron fallback 主机只有重装后才获得 2 分钟闸门延迟；daemon 主机重装后获得退避+抖动与 enroll 修复
- **部署触发说明**：本批改 `src/cli/**`、`src/shared/agent-releases.json`、`app/events/page.tsx`、`messages/*.json`——均不在 deploy-vps.yml paths-ignore 内（实地核对 9-28 行），**每次 push main 自动部署生产**。所有 commit 单独可运行（铁律 5），服务端与 agent 改动相互独立、任意中间 commit 部署均后向兼容；建议 F005（账本）作为最后一个 commit push，使「设备亮 behind 提示」发生在全部 agent 代码已在 main 之后

## 测试计划

| 文件 | 新/改 | 关键用例 |
|---|---|---|
| `tests/cli/service-cron.test.ts` | 新 | 双条目生成、旧单条目升级替换、卸载清零、幂等、用户无关行保留 |
| `tests/cli/harness-backoff.test.ts` | 新 | 成功复位、指数序列、封顶、抖动边界、non-retryable 同样退避 |
| `tests/cli/enroll.test.ts` | 新 | agentFetch 注入断言、失败不写 credentials |
| `tests/server/events-cursor.test.ts` | 新 | 游标编解码往返、非法输入、同时间戳 tiebreak |
| `tests/cli/agent-lifecycle.test.ts` | 可能改（未核） | tick 调度提炼后的回归适配 |
| 全量 | — | `npm run test` + `npm run verify` + `npm run lint`；重点回归 `tests/cli/harness.test.ts`、`tests/evaluator/bl-agent-release-acceptance.test.ts` |

## 依赖与前置

- **前置批次：无硬依赖。** 与近期其他批次（BL-GATE-INBOX / BL-TRANSITION-LOG / BL-COST-BATCH-V1 / BL-BUDGET）改动面正交（它们是服务端+UI，本批主要是 `src/cli/**`），可并行或任意顺序
- **被依赖：** BL-AGENT-SUPPLY-CHAIN（中期）将基于本批延续的 `agent-releases.json` 账本做锁 tag + sha 校验；BL-GATE-INBOX 的「收件箱批准」体感依赖本批把 cron 主机闸门延迟压到 2 分钟才完整成立（软依赖，不阻塞）
- 本批完成后 `.auto-memory/project-status.md` 与 roadmap 中 BL-AGENT-LATENCY 行应标记完成

## 风险与对策

| 风险 | 对策 |
|---|---|
| push 即部署生产：本批 5 个 feature 都会触发 deploy | 每 commit 独立可运行且后向兼容；本地 `npm run verify + test` 全绿再 push；F005 押后为最终 commit |
| crontab 过滤误伤用户自有 cron 行 | 过滤锚定 `binPath`（`~/.local/bin/tokenizer`）而非裸字符串 "tokenizer"；纯函数单测覆盖「混有用户行」输入 |
| 退避封顶 600s 使故障恢复后闸门中继最长多等 10 分钟 | 封顶值取 600s（仍远优于故障期每 60s 重撞）；成功一轮立即复位 60s；heartbeat/sync 节拍不受影响 |
| 存量 cron 主机不重装则收益为零 | F005 账本条目使控制台对所有 behind 设备亮 `upgrade-required` 提示，附安装命令（既有机制，src/server/agent-version.ts:76-95 per 域报告，聚合函数本体已核 84-88 行） |
| 测试中硬编码 "1.2.1" 因账本追加而翻红 | 实地核对为 mock 任意合法版本语义、不比对 latest（低险）；以 F005 acceptance 4 的全量跑通兜底，翻红则改测试注入 fixture 而非改产品逻辑 |
| `tokenizer harness --json` 每 2 分钟一次 git 遍历多仓的负载 | 单飞已内建（每次进程独立、30s 请求超时 harness.ts:49）；2 分钟周期为节拍下限的保守选择；stdout 丢弃避免日志膨胀 |
| 旧 daemon 与新 crontab 双条目并存期的并发写 | 既有单实例锁（agent-lock）与服务端幂等/单调接受（heartbeat/route 单调 reporter）已覆盖；install.sh 升级路径先 stop 再装（install.sh:229-230） |

## 规模估计

**M** · 5 个 feature · 主要涉及文件约 12 个（产品代码 6：`src/cli/service.ts`、`src/cli/agent.ts`、新 `src/cli/harness-backoff.ts`、`src/cli/enroll.ts`、`app/events/page.tsx`、新 `src/server/events-cursor.ts`；数据/文案 3：`src/shared/agent-releases.json`、`messages/en.json`、`messages/zh-CN.json`；测试 4 新 + 1 可能改）。无 migration、无协议变更、无 AGENT_FEATURE_VERSION bump。