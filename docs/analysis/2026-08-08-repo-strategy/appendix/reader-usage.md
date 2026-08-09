# tokenizer 原始产品域分析报告：AI 编程 CLI token 用量统计

## 1) 用量统计功能清单

### 1.1 本机日志采集（agent CLI）
| 能力 | 代码路径 | 说明 |
|---|---|---|
| 采集调度入口 | `src/cli/collect.ts:17-49`（`collectEvents`） | 按 `config.sources` 开关逐源调 parser，聚合 events + warnings |
| CLI 子命令 | `src/cli/index.ts:18-108` | `init / configure / enroll / collect / sync / run / heartbeat / agent / install-service / uninstall-service / service-status / status / diagnose` |
| 常驻 agent | `src/cli/agent.ts:38-97, 124-233` | 单进程循环：heartbeat 60s、collect+sync 15min、quota 刷新、harness 同步；macOS launchd（`src/cli/service.ts`）+ Windows 服务（`src/cli/service-windows.ts`） |
| 增量游标 | `src/cli/cursor.ts`（`shouldSkipFile`/`recordFile`） | 文件指纹跳过未变文件；OpenCode 另有 `time_created` 水位（`src/parsers/opencode.ts:97`） |
| git 上下文富化 | `src/cli/git.ts:23-60`（`enrichEventsWithGit`） | 为事件补 `repoKey`（归一化 remote）/ `gitRemote` / `gitBranch` / `gitCommit` |
| 本地队列 + 上传 | `src/cli/collect.ts:54-65`（截断写队列 + `dedupeBySourceEventId`）、`src/cli/sync.ts:42-70`（批量 POST `/api/usage/events/batch`，逐批重试） | 服务端幂等，重试安全 |

**支持的 CLI 工具（5 个，`UsageSource` 定义于 `src/shared/usage.ts:3`）：**

| CLI | Parser | 数据源 | 关键机制 |
|---|---|---|---|
| Claude Code | `src/parsers/claude.ts` | `~/.claude/projects/**/*.jsonl` + legacy `session-meta` | 按 `message.id` 分组、以最后一条流式行为准（修 ~17% 输出低估）；mid-request 模型 fallback 按 `usage.iterations` 拆段计费（`claude.ts:236-273`）；parser 版本号 `CLAUDE_PARSER_VERSION=2` 触发一次性重解析（`claude.ts:15,26-37`） |
| Codex | `src/parsers/codex.ts` | `~/.codex/sessions/**/*.jsonl` | `token_count` 事件；session 级高水位取正增量（`codex.ts:69-76`，依赖 `src/shared/codex-usage.ts`）；内容指纹去重修复历史 1432 行重复回归（`codex.ts:42-49`） |
| OpenCode | `src/parsers/opencode.ts` | SQLite `opencode.db`（better-sqlite3，多候选目录探测 `openCodeDataDirs`，`opencode.ts:29-43`） | SQL join message/session/project；自带 `costUsd`（`opencode.ts:158`） |
| Aider | `src/parsers/aider.ts` | 项目内 `.aider.chat.history.md` 文本 | 正则解析 "Tokens: … sent, … received. Cost: …" 行（`aider.ts:16-23`）；自带每条 message 成本 |
| Kimi Code | `src/parsers/kimicode.ts` | `~/.kimi-code/sessions/**/wire.jsonl` | 只取 `usage.record` + `usageScope==="turn"` 增量行（`kimicode.ts:82`）；含子 agent 各自 wire 文件 |

诊断子命令覆盖 opencode 与 kimicode（`src/cli/index.ts:97-108`，`diagnoseOpenCode` / `diagnoseKimiCode`）。

### 1.2 订阅配额（quota）采集
- Provider 框架：`src/quota/registry.ts:6`——`DEFAULT_PROVIDERS` 目前**仅 1 个**：`codexChatgptProvider`。
- `src/quota/codex-chatgpt.ts:4,38-83`：读 `~/.codex/auth.json` access token，请求 `chatgpt.com/backend-api/wham/usage`，映射 plan / primary/secondary rate-limit 窗口 / code-review 窗口 / credits 为 `QuotaSnapshot`（`codex-chatgpt.ts:85-137`）。
- 刷新调度：`src/quota/run.ts:11-66`（单飞 + 失败状态落 `state.json`）；上报路由 `app/api/quota/snapshots/batch/route.ts`；读取 `src/server/quota.ts:42-80`（`DISTINCT ON` 每 provider×window 取最新）；前端 `SubscriptionCard`（`app/page.tsx:41,160-161`）。

### 1.3 服务端入库（ingest）
- `src/server/ingest.ts:136-211`（`ingestUsageEvents`）：Project 归一（repoKey 优先、workspacePath 兜底、无 git 无法跨设备合并——`ingest.ts:94-97` 明示为 known limitation）→ `createMany skipDuplicates` 幂等（`ingest.ts:173-176`）→ 按 `agentFeatureVersion` 门控的 in-place 修正 `correctStaleDuplicates`（`ingest.ts:185-188, 277-353`，带审计日志）→ 未定价模型检测（`ingest.ts:196`）。
- NUL 字节清洗防 jsonb 整批失败（`ingest.ts:12-29`）；codex sourceEventId 服务端二次 canonical 化（`ingest.ts:216-220`）。

### 1.4 定价与成本估算
- 静态价目表 `MODEL_PRICES`（USD/1M tokens，四段：input/cacheRead/cacheWrite/output）覆盖 Anthropic / OpenAI+Codex / Gemini / DeepSeek / GLM / Kimi / MiMo：`src/shared/model-pricing.ts:24-101`；`estimateCost`/`decomposeCost`（`model-pricing.ts:130,168`）。
- 自动定价管道：`ModelPrice` 全局表（`prisma/schema.prisma:277-299`，状态机 detected→auto_applied/pending_review→approved/rejected）；查价链 LiteLLM → OpenRouter → LLM fallback（`src/server/pricing/lookup.ts:38+`，TOCTOU 守卫 `updateIfPending` 22-31）；admin 审核页 `app/admin/pricing/` + `app/api/admin/pricing/scan|review`；生效价 = seed + DB overlay，tag 缓存失效（`src/server/model-prices.ts:49-51`）。

### 1.5 展示页面（app/）
- **Overview** `app/page.tsx`：`getSummary/getDailySummary/getDailyCost/getDailyBySource/getBreakdown`（source/model 两维）+ 订阅卡；图表组件 `app/daily-usage-chart.tsx`、`daily-cost-chart.tsx`、`daily-source-chart.tsx`。
- **/events** `app/events/page.tsx`：最近 200 条明细（`prisma.usageEvent.findMany take:200`），含 cacheWrite/cacheRead/reasoning/serviceTier/fallback 列。
- **/devices**、**/devices/[id]**：设备清单 + 详情（`getDeviceSummary/getDeviceDetail/getDailyForDevice`，`src/server/summaries.ts:245,625`），agent 版本、队列深度、lastError 诊断。
- **/projects/[id]**：`getProjectDetail`（`summaries.ts:792`）。
- **/models/[model]**：`getModelDetail/getDailyForModel` + 自选时间窗（`summaries.ts:404,575`）。
- 聚合层：30s `unstable_cache`（`summaries.ts:14`）；口径 `billable = max(0, input − cached) + output`（`summaries.ts:44-52`）；用户时区分桶（`src/server/time-buckets.ts`、`User.timezone` + `app/_components/timezone-reporter.tsx`）；i18n en/zh-CN（`messages/`）。
- 设备注册：一次性 `EnrollmentToken` 换长期 `DeviceToken`（`app/api/devices/enroll`、`src/cli/enroll.ts`）；心跳带诊断（`app/api/devices/heartbeat/route.ts`）；agent 升级提示（`src/shared/agent-feature-version.ts` + `app/_components/outdated-badge.tsx`/`upgrade-banner.tsx`）。

## 2) 数据模型概览（prisma/schema.prisma，457 行）

**用量域核心表：**
- `User`（14-39）：租户根，所有业务表按 `userId` 隔离。
- `Project`（82-100）：`@@unique([userId, workspacePath])` + `@@unique([userId, repoKey])`。
- `Device`（102-135）：agent 版本/诊断列 + **harness 同步列混居**（见 §4）。
- `EnrollmentToken`（137-154）/ `DeviceToken`（156-174）：hash 存储、prefix 展示。
- `UsageEvent`（176-229）：核心事实表。幂等键 `@@unique([deviceId, source, sourceEventId])`（216）；计量列 input/output/cachedInput/cacheWrite/reasoning/ephemeral5m/1h/webSearch/webFetch/serviceTier/costUsd/fallbackFrom/ToModel（191-207）；13 个索引覆盖各查询维度（217-228）。
- `QuotaSnapshot`（231-250）：provider×accountKey×windowKey 时序快照。
- `CollectorState`（252-265）：服务端游标存储（`@@unique([userId, source, key])`）。
- `ModelPrice`（277-299）：**唯一非租户表**，全局每 modelKey 一行。

**harness 域表（同库同 schema）：** `HarnessProject`（306-346）/ `HarnessGate`（348-388）/ `HarnessModeIntent`（390-422）/ `HarnessDispatchRun`（424-457）。

关系要点：`UsageEvent → User/Device(Cascade), Project(SetNull)`；`HarnessProject.projectId → Project(SetNull)`（338），靠 `repoKey` 与用量 Project 同口径关联（310 注释）。

## 3) 成熟度评估

**完成度：高。** 5 源解析全部带增量游标、幂等入库、流式修正、双平台服务安装、多租户、时区、i18n、自动定价管道齐备。工程质量细节密集（NUL 清洗、parser 版本化重解析、codex 高水位去重、TOCTOU 守卫均有注释交代历史事故来源）。

**测试覆盖（vitest，tests/ 共约 14.5k 行，但其中相当比例属 harness 域，如 `harness-tool-catalog.test.ts` 1304 行）：**
- Parser 全覆盖：`tests/parsers/` claude 550 / codex 201 / opencode 178 / kimicode 152 / aider 113 行。
- Ingest：`tests/server/ingest-upsert.test.ts`（246）+ `ingest-project.test.ts`（178）。
- 定价：`pricing-sources/pricing-mapping/pricing-review/model-detect/model-prices` 5 个文件。
- Quota：`tests/quota/` 3 文件（auth-file/codex-chatgpt/registry）。
- CLI：collect/cursor/sync-retry/git/agent-lifecycle/atomic-file/service-windows/proxy-env/file-permissions。

**明显短板：**
1. `src/server/summaries.ts` 1128 行是展示层核心，直接测试仅 `tests/server/daily-range.test.ts`（只测纯函数 `localDateRange`）+ `summary-metrics.test.ts`（65 行）；`getSummary/getModelDetail/getProjectDetail` 等聚合函数无 DB 集成测试。
2. `app/` 页面零 UI/E2E 测试（仅 `mode-badges`/`upgrade-banner` 等抽出的纯逻辑有测试）。
3. Quota 只有 1 个 provider（`src/quota/registry.ts:6`）；Claude/Gemini 等订阅配额未采集。
4. Aider 事件 `occurredAt` 取 session header 或文件 mtime（`aider.ts:131`），同 session 所有 turn 共享同一时间戳，时间粒度失真；`sourceEventId` 含文件行号（`aider.ts:121`），历史文件被改写会漂移。
5. Kimi Code `sourceEventId` 同样含文件路径+行号（`kimicode.ts:100`），无 codex 式 canonical id 兜底。
6. `/events` 固定 `take: 200` 无分页。
7. 成本为 list-price 估算：除 opencode/aider 自带 `costUsd` 外全靠价目表，订阅制用户（Claude Max 等）的"花费"并非真实账单。
8. 非 git 项目跨设备产生重复 Project 行（`ingest.ts:94-97`，已知限制）。

## 4) 用量域与 harness 控制台域的代码层耦合点

| 耦合类型 | 具体位置 | 说明 |
|---|---|---|
| **共享表：Device 列混居** | `prisma/schema.prisma:121-123`（`lastHarnessSyncAt`/`harnessSyncStatus`/`harnessDiagnostics` 直接长在用量域 `Device` 表上） | 最强耦合——不是外键关联而是同表同列 |
| **共享表：Project 外键** | `schema.prisma:313,338`（`HarnessProject.projectId → Project`）；写入点 `app/api/harness/report/route.ts:488-492,567`（按 `userId+repoKey` findFirst 用量 `Project` 后回填） | harness 项目靠 `repoKey` 同口径挂到用量 Project，实现"用量 × 编排进度"对齐 |
| **共享表：User 关系根** | `schema.prisma:35-38`（`harnessProjects/harnessGates/harnessModeIntents/harnessDispatchRuns` 与 `usageEvents/quotaSnapshots` 同挂 User） | 同一租户模型 |
| **共享认证** | `authenticateDeviceToken`（`src/server/auth.ts`）同时守 `app/api/usage/events/batch/route.ts:11`、`app/api/quota/snapshots/batch/route.ts:24`、`app/api/harness/report/route.ts:477,736` | 同一 DeviceToken 通道承载用量上报与 harness 上报/闸门中继 |
| **共享路由：heartbeat** | `app/api/devices/heartbeat/route.ts:70-73,161-164` | 用量心跳的 diagnostics 载荷内嵌 harness 快照并写回 Device harness 列 |
| **共享类型** | `src/shared/usage.ts:54`（`DeviceDiagnostics.harness?: HarnessSyncSnapshot`） | 用量域类型文件 import harness 域类型（文件第 1 行） |
| **共享进程：CLI agent** | `src/cli/agent.ts:84-97`（`runOnce` 末尾串 `runQuotaRefresh` + `runHarnessSync`）、`agent.ts:197-233`（同一 tick 循环调度三者） | 采集 agent 与 harness 上报/中继是同一个 launchd 常驻进程 |
| **共享组件/导航** | `app/_components/harness-health-badge.tsx` 被用量域设备页引用（`app/devices/page.tsx:19,289`、`app/devices/[id]/page.tsx:18-121`）；侧边导航 `src/routes.tsx:27-29` 将 `/harness` 与 overview/events/devices 并列；两域共用 `AdminShell`（`app/admin-shell.tsx`）与 Sidebar/Navbar | UI 壳层完全共享 |

**边界现状总结：** 两域在 schema（Device 列混居、Project 外键）、传输（同 token、同 heartbeat 路由）、进程（同 agent 循环）、UI 壳四层均有耦合；解耦最困难的是 `Device` 表上的 harness 列与 `DeviceDiagnostics` 内嵌类型，其余（HarnessProject 四表、`/api/harness/*`、`app/harness/`、`src/cli/harness*.ts`）目录边界清晰、可独立剥离。