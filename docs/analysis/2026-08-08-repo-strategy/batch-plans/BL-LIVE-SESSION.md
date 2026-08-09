# BL-LIVE-SESSION 落地方案

## 目标

兑现 P3（console-mode.md §7「设计已定未实装」）：让控制台详情页能回答「这个项目**现在**在干什么——跑到哪个 feature、闸门卡在哪、多久没动了」。v1 交付三件东西：

1. agent 侧**默认关闭、显式 opt-in** 的会话态上报——每 60s 节拍对每个 harness 项目派生**有界结构化会话事件**（非原始日志）；
2. 服务端环形缓冲表（每项目上限 + 保留期）+ 新增独立上报端点；
3. `/harness/[id]` 详情页新增 **live tab**：事件时间线 + LIVE/idle 活跃徽章 + 「未开启 / agent 不支持」状态区分。

**核心取舍（v1 做「harness 事件」，不做「日志 tail」）**，三条机械依据：

- 服务端已有主动防线：`src/server/harness-mode-intent-api.ts:34-38` 的 `RAW_CHANNEL_PATTERN` / `CREDENTIAL_PATTERN` / `SENSITIVE_FIELD_PATTERN`，经 `safePersistedSummary`（同文件 194-223 行）对**所有**入库字符串生效——凡长得像 stdout/logs/env/凭据的内容一律拒收。上报原始日志行等于在新端点上豁免这道既有防御姿态，方向性冲突。
- console-mode.md §6 红线（335-348 行区间）：原始日志会把命令输出、报错正文里的凭据片段持久化到控制台机器，触发磁盘加密/访问控制/留存期的全额义务。结构化事件的隐私面 ≈ 既有 report 镜像（progress/features 本来就在上报），不触发该重义务。
- harness 项目本地**没有标准的会话日志文件**（`framework/harness/` 无日志约定；真正的会话日志是 Claude Code 的 `~/.claude/projects/**.jsonl`，内含 prompt 与工具输出正文——恰是红线所指）。而 P0 缺口 #1（roadmap.md §2.1）要的是「正在跑哪个 feature、卡在哪」= 会话**态**，结构化事件足以回答。原始 tail 留给 v2，前置义务清单写进 spec（见「风险与对策」）。

## 范围（In / Out）

**In：**
- agent：`config.json` 新增 `liveSession` 开关（默认无字段 = 关）；每 tick 对启用项目做本地状态 diff，派生白名单事件（status 变更 / feature 状态变更 / 闸门举起与消费 / HEAD 前进 / autonomy halt / batch 切换），批量 POST 新端点；404/失败静默降级不影响 report/relay 三步（沿用 `runHarnessSync` 互不阻塞模式，src/cli/harness.ts:640-693）。
- 服务端：`HarnessSessionEvent` 表 + `HarnessProject.liveSessionAt` 列；`POST /api/harness/session-events`（写入时执行环形上限 200 条/项目 + 14 天保留期）。
- UI：live tab（时间线 + LIVE 徽章，活跃判定对齐 `HARNESS_SYNC_STALE_MS` 3 分钟口径，src/shared/harness-health.ts:4）。
- 能力版本：`AGENT_FEATURE_VERSION` 9→10；**`MIN_AGENT_FEATURE_VERSION` 保持 9**（论证见协议节）。

**Out（刻意不做）：**
- **原始日志 tail / 全量日志流** → v2（前提：§6 义务清单落实 + 独立端点 + 明确脱敏方案，届时另立批次）。
- **控制台下发开关**（签名下行通道）→ 开关放本机 config.json。理由：控制台唯一写操作是闸门 decision + intent 签发（console-mode.md §8 红线 1；app/api/harness/gates/route.ts:9-17 文件头注释），新增下发面应复用签名 intent 骨架，留给 **BL-STEERING-V1** 之后统一。
- **SSE/推送实时性** → 沿用 60s 轮询 + 页面 30s AutoRefresh（app/harness/[id]/page.tsx:51），「实时」定义为分钟级。推送通道是 P4 的事。
- **阶段耗时统计/时间线聚合** → **BL-TRANSITION-LOG**（服务端 diff 派生 HarnessTransition）与 **BL-PERF-ANALYTICS** 的地盘；本批次事件表只做观测流，不做聚合。

## Features 预案

**F001 · agent 侧会话事件派生与上报 · executor: generator**
- 涉及文件：`src/cli/harness-live.ts`（新建：diff 引擎 + 事件构造 + 上报）、`src/cli/config.ts`（`TokenizerConfig` 加 `liveSession?: { enabled: boolean; projects?: string[] }`，9-19 行；`TokenizerState` 加 per-repoKey 游标，125-131 行）、`src/cli/harness.ts`（`runHarnessSync` 加第四步，640-693 行）、`src/cli/index.ts`（configure 加 `--live-session` 旗标）、`src/cli/harness-command.ts`（`--status` 输出补 live 开关状态）
- acceptance：
  1. `liveSession` 字段缺失或 `enabled:false` 时，实跑 `runHarnessSync` 全程零请求打到 `/api/harness/session-events`（测试断言 fetch mock 未被调用）；
  2. 构造 progress.json status 从 `building`→`verifying` 的两次 tick，派生出恰一条 `status_change` 事件，`occurredAt` 为 UTC ISO 8601（`Z` 结尾正则断言）；
  3. 单项目单批次事件 ≤20 条、单条自由文本字段（commit subject）≤256 字符，超限截断/丢弃有测试覆盖；subject 命中凭据模式（如 `ghp_` token）时该字段置 null 上报；
  4. 端点 404 时本轮 issues 记 `live_session` 操作项、report/relay 两步照常完成（断言三步结果互不影响）；
  5. `~/.tokenizer/state.json` 游标损坏/清空后重跑不重复入库（服务端幂等键兜底测试见 F002）。

**F002 · 服务端 session-events 端点 + 环形缓冲表 · executor: generator**
- 涉及文件：`app/api/harness/session-events/route.ts`（新建）、`prisma/schema.prisma`（新 model + `HarnessProject` 加 `liveSessionAt DateTime?`，306-346 行区段）、`prisma/migrations/2026080?000000_add_harness_session_events/`（新建）、`src/server/harness-mode-intent-api.ts`（复用导出 `safePersistedSummary`/`readBoundedJson`/`parseUtcDate`，必要时仅加导出不改逻辑）
- acceptance：
  1. 无 Bearer 401；带旧 agent 身份头（featureVersion < 10）409/403 拒写（对齐 `reporterCanWriteHarness` 模式，app/api/harness/report/route.ts:406-432）；
  2. 载荷字段白名单：未知字段 400 `unknown_field`；超 64KB（`HARNESS_API_MAX_BYTES`，harness-mode-intent-api.ts:30）413；
  3. 同 `(harnessProjectId, seq)` 重放两次，表内仍一行（unique + skipDuplicates）；
  4. 写入第 201 条后，该项目行数仍 ≤200 且被删的是 seq 最小者；`occurredAt` 早于 14 天的行在下次写入时被清除（测试用注入时钟）；
  5. 用户 A 的 token 不能写入/读到用户 B 的 harnessProject 事件（ownership 测试）；空事件批也更新 `liveSessionAt`。

**F003 · 详情页 live tab · executor: generator**
- 涉及文件：`app/harness/[id]/page.tsx`（`VIEWS` 加 `"live"`，16 行；tab 渲染分支 95-107 行）、`app/harness/[id]/views.tsx`（新增 `LiveView`，参照 540 行 `ActivityView` 模式）、`src/server/harness-detail.ts`（查询加 `sessionEvents` take 50 + `liveSessionAt`，3-107 行）、`messages/en.json`、`messages/zh-CN.json`（`harness.detail.tabs.live` 等键）
- acceptance：
  1. `npm run verify` 与 `npm run lint` 全绿；
  2. 有事件时时间线按 `occurredAt` 降序渲染，时间经用户时区管道（与 ActivityView 同一 `timezone` prop）；
  3. `liveSessionAt` 距今 ≤3 分钟显示 LIVE 徽章，否则显示 idle/最后活跃时间（组件级测试或 vitest 断言判定函数）；
  4. 三态区分可断言：`agentFeatureVersion < 10` → 「agent 不支持，需升级」；`>=10` 且 `liveSessionAt` 为 null → 「未开启（本机 config.json opt-in）」；有 `liveSessionAt` 无事件 → 「无活动」；
  5. 两个 locale 文件键集合一致（现有 i18n 测试口径或新增断言）。

**F004 · 能力版本推进与发布账本 · executor: generator**
- 涉及文件：`src/shared/agent-feature-version.ts`（`AGENT_FEATURE_VERSION = 10`、新增 `MIN_LIVE_SESSION_AGENT_FEATURE_VERSION = 10`、History 注释补第 10 条，50-51 行）、`src/shared/agent-releases.json`（追加 1.3.0 条目，`agent_feature_version: 10`）、`tests/server/agent-version.test.ts`（22-23 行断言改 10/9）、`tests/evaluator/bl-agent-release-acceptance.test.ts`（350-354 行断言更新，须在 commit 正文注明是版本推进的机械后果而非改写历史验收）
- acceptance：
  1. `AGENT_FEATURE_VERSION === 10`、`MIN_AGENT_FEATURE_VERSION === 9`、`AGENT_FEATURE_VERSION >= MIN_AGENT_FEATURE_VERSION` 三断言全过（第三条是既有 tests/server/agent-version.test.ts:36 守门）；
  2. `npm run test` 全量绿（含被更新的两处历史断言）；
  3. `agent-releases.json` 末项 version 为 1.3.0 且 `released_on` 为 UTC 日期、双语 highlights 齐备（既有 release 账本测试口径）；
  4. 服务端 `isDeviceOutdated(9) === false`（opt-in 特性不强推升级的机械体现）。

**F005 · 隐私红线与防注入审计 · executor: evaluator**
- 涉及文件（产出）：`docs/test-cases/BL-LIVE-SESSION-privacy-audit.md`、`docs/test-reports/BL-LIVE-SESSION-*.md`；（只读审计对象）F001/F002 全部改动 + `src/server/harness-mode-intent-api.ts`
- acceptance：
  1. 构造含 `-----BEGIN PRIVATE KEY-----`、`Bearer xxx`、`stdout:` 前缀的载荷灌入端点，逐条验证被拒或字段置空，结论落报告；
  2. 实测保留期与环形上限（时钟注入 + 越界写入），报告附命令输出；
  3. 核对 console-mode.md §6/§8 红线逐条映射到实现（默认关、控制台零下发、无 evidence 正文入库），给出 PASS/FAIL；
  4. 报告按推送前遗漏检查随批次 commit（`git status --short docs/test-reports/` 干净）。

## 数据模型 / migration

```prisma
model HarnessSessionEvent {
  id               String   @id @default(cuid())
  userId           String
  harnessProjectId String
  seq              BigInt            // agent 侧单调游标（毫秒时间戳基底，state 丢失不回退）
  kind             String            // status_change | feature_status_change | gate_raised |
                                     // gate_cleared | head_advance | autonomy_halt | batch_change
  batch            String?
  feature          String?
  fromValue        String?           // ≤64
  toValue          String?           // ≤64
  detail           String?           // ≤256，经 safePersistedSummary，可 null
  occurredAt       DateTime          // UTC，agent 观测时刻
  createdAt        DateTime @default(now())
  user           User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  harnessProject HarnessProject @relation(fields: [harnessProjectId], references: [id], onDelete: Cascade)
  @@unique([harnessProjectId, seq])
  @@index([harnessProjectId, occurredAt])
  @@index([userId])
}
```
另：`HarnessProject` 加 `liveSessionAt DateTime?`。一个 migration，纯 additive（新表 + 一可空列），对现网数据零风险。保留策略在写入路径强制（无全局定时清理任务可挂——已核实 `src/server/cleanup.ts` 是 Claude legacy 专用）。

## API 与协议影响

- **新增** `POST /api/harness/session-events`：Bearer device token + 既有成对身份头（`x-tokenizer-agent-release-version` / `x-tokenizer-agent-feature-version`，src/shared/harness-relay-identity.ts）；body ≤64KB，`{ projects: [{ repoKey, events: [...] }] }`，空 events 也合法（作 liveness keepalive，只刷 `liveSessionAt`）。
- **既有端点零改动**：report 载荷白名单（app/api/harness/report/route.ts:452-473 `parseReport` 的 exactRecord）一个字段都不加——这是本方案对「尽量不动 agent↔服务端协议」的落实方式：新通道 additive、默认关、旧 agent 完全无感知，9 个消费者项目零升级压力。
- **AGENT_FEATURE_VERSION：bump 至 10；MIN_AGENT_FEATURE_VERSION 保持 9（不同步）**。论证：bump 注释的既定规则是「should prompt users to upgrade 时才 lockstep bump；stragglers acceptable 就不动」（agent-feature-version.ts:14-17）——本能力 opt-in 默认关，旧 agent 滞留完全可接受，不应全网弹升级提示；但 agent 必须自证能力级（10），否则 UI 无法区分「agent 不支持」与「未开启」，且 capability 单调接受（report/route.ts:406-432）继续防旧 daemon 降级。不等式守门测试（agent-version.test.ts:36 只要求 `>=`）允许这种分离；这是本仓首次二者不相等，两处 `toBe(9)` 硬断言的更新在 F004 显式列账。
- **部署触发**：本批次改 `src/`、`app/`、`prisma/`、`messages/`——全部**不在** deploy-vps.yml paths-ignore（9-28 行）内，**每次 push main = 一次生产部署**。建议编排者：building 期间按 feature 本地 commit，集中 1-2 次 push（deploy-vps.yml 有 `concurrency: deploy-vps` 串行保护，34-36 行）；migration 随部署路径 `npx prisma migrate deploy` 自动应用；服务端天然先于 agent 生效（agent 升级需人工重装 install.sh），期间新服务端 + 旧 agent 完全兼容。

## 测试计划

- `tests/cli/harness-live.test.ts`（新建）：F001 acceptance 全部用例——开关缺省关、diff 派生正确性、事件/字段上限、凭据 pattern 置空、404 降级不阻塞三步、UTC 格式断言、state 游标损坏恢复。
- `tests/server/harness-session-events-route.test.ts`（新建）：F002 acceptance 全部用例——鉴权/身份门槛、白名单/413、seq 幂等、环形上限 200、14 天保留、跨用户隔离、keepalive 刷 `liveSessionAt`、`RAW_CHANNEL_PATTERN`/`CREDENTIAL_PATTERN` 拒收（与 F005 审计互补：这里是白盒单测，F005 是黑盒灌入）。
- `tests/server/harness-detail.test.ts`（修改）：查询含 `sessionEvents`（take 50、降序）与 `liveSessionAt`。
- `tests/server/agent-version.test.ts`（修改）：22-23 行改 `toBe(10)` / `toBe(9)`。
- `tests/evaluator/bl-agent-release-acceptance.test.ts`（修改）：350-354 行版本断言更新。
- 回归：`npm run test` 全量 + `npm run verify`（tsc）+ `npm run lint`。

## 依赖与前置

- **硬前置：无**。数据模型、端点、UI 全部自包含。
- **软重叠：BL-TRANSITION-LOG**（近期批次，服务端从 report diff 派生 HarnessTransition）。`status_change` 事件与之语义重叠（同为 60s 观测粒度）。若 TRANSITION-LOG 先行落地，本批次 live tab 的 status 变更行改为读 HarnessTransition、session 事件保留 feature/gate/commit 粒度——**建议编排者在 planning 时裁决先后**，避免两张表存同一事实。
- **被依赖**：BL-STEERING-V1（live tab 是 steering 指令的观察面，「看到卡住→按暂停」的前半程）；BL-PERF-ANALYTICS（事件流可作会话活跃度素材）；远期 P4（session-events 通道形状是「机器主动出站上报」的又一次演练）。

## 风险与对策

| 风险 | 对策 |
|---|---|
| push = 部署，多 feature 多次滚动生产 | 集中 push（1-2 次）；migration additive；concurrency 串行已配 |
| 一条脏事件废掉整批上报（服务端整批白名单拒收） | 双端清洗：agent 侧先按同源 pattern 把不合格 `detail` 置 null（F001-ac3），服务端保持整批严格校验作防御纵深；单测两端都覆盖 |
| agent state 游标丢失导致 seq 回退/撞库 | seq 以毫秒时间戳为基底单调生成 + `@@unique(harnessProjectId, seq)` skipDuplicates 兜底 |
| 历史 signoff 测试断言（bl-agent-release-acceptance）被修改的观感 | F004 显式列账 + commit 正文注明机械依据（版本推进），evaluator 复验时按 spec 对照 |
| 隐私红线被后续迭代侵蚀（有人往 detail 塞日志正文） | F005 审计报告固化基线；spec 写死「v2 raw tail 前置义务清单」：独立端点、磁盘加密/访问控制声明、留存期可配、控制台机器按持钥系统对待（console-mode.md §6） |
| 版本耦合测试税（README §3.3 BL-TOKENIZER-ADOPT-V170 实证） | 本批次只动 agent 版本不动框架版本；两处硬断言更新已在 F004 定价 |
| 表增长 | 200 条/项目 × 14 天 × 本机 9 项目 ≈ 最多 1800 行，忽略不计；cap 在写入路径强制，不依赖外部 cron |

## 规模估计

**M** · 5 features（4 generator + 1 evaluator） · 涉及文件约 18 个（新建 6：`harness-live.ts`、session-events route、migration、2 个测试文件、审计报告；修改 12：`config.ts`、`harness.ts`、`index.ts`、`harness-command.ts`、`schema.prisma`、`harness-detail.ts`、`page.tsx`、`views.tsx`、`agent-feature-version.ts`、`agent-releases.json`、`messages/{en,zh-CN}.json`、3 个既有测试文件——按去重后计）。核对说明：本方案所有引用路径均已实地打开核对；行号为撰写时实测，`views.tsx` 新增 `LiveView` 的插入位置与 i18n 具体键名属实现自由度，未逐键预核。