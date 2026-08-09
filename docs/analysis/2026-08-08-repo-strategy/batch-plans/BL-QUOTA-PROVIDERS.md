# BL-QUOTA-PROVIDERS 落地方案

> 事实核对说明：本方案中标注「已核」的路径/行号均已实地打开核对（2026-08-09，工作区 main @ afa0297）；标注「未核」的为无法在本机静态确认的外部事实，留给 F001 调研裁决。本机（macOS）对 `~/.claude/`、`~/.kimi-code/` 做了实地目录探测，作为可行性初步证据（单机样本，不能代表 Linux/全体用户）。

## 目标

把订阅配额采集从 1 个 provider（codex-chatgpt）扩展到 3 个：新增 **Claude（Claude Code 订阅）** 与 **Kimi（Kimi Code 订阅）**，并把首页 SubscriptionCard 从 codex 硬编码泛化为多 provider 渲染。全程沿用现有 provider 框架的「探测 + 优雅缺席 + fail-quiet」契约：机器上没装该 CLI / 凭据不可读 / 端点失效时静默缺席，绝不影响采集主循环。**方案显式允许调研后砍掉不可行的 provider。**

关键既有事实（全部已核）：

- provider 框架就位且天然多 provider：`src/quota/registry.ts:6` 的 `DEFAULT_PROVIDERS` 数组逐个跑 `isConfigured()` 门控，错误按 `provider.id` 分键收集不抛出（registry.ts:15-39）——新增 provider = 追加数组元素，框架零改动
- 参考实现完整：`src/quota/codex-chatgpt.ts:31-83`（读 `~/.codex/auth.json` → 官方 usage 端点 10s 超时 → `mapResponseToSnapshots` 映射窗口，85-150 行）；凭据读取的只读伦理写在 `src/quota/auth-file.ts:14-17` 注释（「we never write to it」，任何错误返回 null）
- 调度已 fail-quiet：`src/quota/run.ts:11-65` 单飞 + `quotaAuthErrors` 按 provider 分键落 state.json 带 `consecutiveFailures`（67-86）；`src/cli/agent.ts:84-91` cron 模式非致命兜底、agent.ts:191-192 节拍 active 60s / idle 300s——多 provider 无需改动
- 上报与读取端全泛型：`app/api/quota/snapshots/batch/route.ts`（provider 为自由字符串）、`src/server/quota.ts:42-80`（`DISTINCT ON` 按 provider×windowKey 取最新，返回 `byProvider` map）——服务端 API 零改动
- **唯一硬编码点**：`app/_components/subscription-card.tsx:12` `latest.byProvider["codex-chatgpt"]`，ConnectedCard/EmptyStateCard/i18n 键（`messages/en.json:411-432`）全部 codex 专属——这是 UI 必改面

本机可行性初探（实测）：

- `~/.claude/`（macOS）**无任何明文凭据文件**（`ls -la` 全清单核过：无 `.credentials.json`、无 auth 类文件；只有 settings.json 等）→ macOS 上 Claude 凭据大概率在 Keychain（服务名与非交互可读性**未核**）；Linux 侧 `~/.claude/.credentials.json` 惯例**未核**
- `~/.kimi-code/credentials/kimi-code.json` **存在且为 OAuth 凭据**（实测键集：`access_token` / `refresh_token` / `expires_at` / `scope` / `token_type` / `expires_in`）；`~/.kimi-code/config.toml` 给出 `base_url = "https://api.kimi.com/coding/v1"`（实测）。**Kimi 是否有 usage/quota 端点：未核**
- Claude 官方 usage/OAuth 端点（社区流传的 `api.anthropic.com/api/oauth/usage` 等）：**未核**，是 F001 的核心裁决项

## 范围（In / Out）

**In：**
1. 数据源可行性调研（Claude + Kimi 各一份 go/no-go 裁决 + 窗口映射表）——executor:evaluator
2. Claude Code 订阅配额 provider（条件启动：F001 判 go）
3. Kimi Code 订阅配额 provider（条件启动：F001 判 go）
4. SubscriptionCard 多 provider 泛化 + i18n 键补齐（条件启动：至少一家 go）
5. agent-releases.json 追加一条 release（软提示用户升级 agent，不动 feature 门槛）

**Out（刻意不做）：**
- **不 refresh 任何厂商 token、不写任何厂商凭据文件**（沿 auth-file.ts:14-17 既定伦理；Kimi `refresh_token` 在场也不用，过期即视为未配置）——永久 Out
- **不做 quota 逼近告警/预算联动** → 留给 BL-BUDGET（roadmap 近期批次，其「quota 逼近提醒」将来直接消费本批次的多 provider 快照）
- **不做 Gemini CLI / Amp 等更多 provider** → 留给后续批次；F004 泛化后新增 provider 的 UI 成本已摊薄
- **不改 quota 轮询节拍/退避策略**（agent.ts:191-192 现状沿用）→ 轮询退避统一归 BL-AGENT-LATENCY
- **不动 QuotaSnapshot schema、不动 /api/quota/snapshots/batch 契约**（见协议节）
- **不修 provider 直连厂商端点不走代理的既有不一致**（codex-chatgpt.ts:58 用全局 fetch 而非 agentFetch，先例照抄；代理场景修复归 BL-AGENT-LATENCY / 代理运行时读取项）

## Features 预案

**批次结构建议（状态机适配）：** F001 是 evaluator 调研 feature，但混合批次的状态流转是 building 先于 verifying（harness-rules 批次类型表），无法「先调研后实现」。建议拆成两个子批次串行：**BL-QUOTA-PROVIDERS-PROBE**（Evaluator-only 批次，仅 F001，`planning → verifying → done`，产物全走部署豁免路径）→ **BL-QUOTA-PROVIDERS**（普通批次，F002-F004，features 清单按 PROBE 结论裁剪后再 planning 定稿）。若编排者坚持单批次，则把调研压进 planning 阶段由 Planner 亲执（代价：失去隔离上下文的独立调研）——不推荐。

---

**F001 · Claude/Kimi 配额数据源可行性调研 · executor:evaluator**
- 涉及文件：产出 `docs/test-reports/BL-QUOTA-PROVIDERS-probe.md`（新建；此目录部署豁免，已核 deploy-vps.yml paths-ignore）；探针脚本放 `docs/test-cases/`（豁免目录）或 scratchpad，**明确不放 `scripts/`**（scripts/ 不在 paths-ignore，推它会白触发一次生产部署）
- 调研项：① Claude 凭据矩阵——macOS Keychain（服务名、`security find-generic-password` 非交互/launchd 环境可读性、是否触发授权弹窗）与 Linux `~/.claude/.credentials.json`；② Claude usage 端点候选实测（状态码、响应 shape、所需 header）；③ Kimi：用本机实测凭据探测 `api.kimi.com/coding/v1` 域下 usage/quota 端点；④ 两家的窗口语义（5h/周窗/重置时刻）→ QuotaSnapshot 映射表；⑤ token 过期语义（Kimi `expires_at` 已确认在场）
- acceptance：
  1. 报告含 Claude、Kimi 各一节，每节以显式 **go / no-go** 结论收尾，并给出「go」时的实现约束清单（凭据路径、端点、header、超时）
  2. 每条事实性断言附实际命令与原始输出（HTTP 状态码 / 目录清单 / security 退出码）；拿不到输出的写「未核」——零无依据断言
  3. macOS Keychain 非交互可读性有非 TTY 环境实测结论（这是 Claude provider 在 macOS 成立与否的单点）
  4. 每个「go」provider 附 响应字段→`windowKey/utilization/resetsAt(UTC ISO)` 映射表，windowKey 命名对齐 codex 约定（`plan` / `rate_limit_primary` / `rate_limit_secondary`）
  5. 报告经脱敏检查：`grep -E '[A-Za-z0-9_-]{40,}'` 零命中（token 不落报告）

**F002 · Claude Code 订阅配额 provider（探测 + 优雅缺席）· executor:generator ·（条件：F001 判 Claude go；no-go 即砍）**
- 涉及文件：新建 `src/quota/claude-auth.ts`（按 F001 结论实现 per-OS 凭据探测，任何失败返回 null）、新建 `src/quota/claude-code.ts`（provider，仿 codex-chatgpt.ts 结构：10s 超时、错误返回不抛出）；修改 `src/quota/registry.ts:6`（数组追加）；新建 `tests/quota/claude-auth.test.ts`、`tests/quota/claude-code.test.ts`
- acceptance：
  1. `npx vitest run tests/quota/claude-code.test.ts tests/quota/claude-auth.test.ts` 全绿；用例覆盖：凭据缺失→`isConfigured()===false`、200 响应→快照映射、401/5xx/超时→返回 `error` 不 throw
  2. 映射产出的每条快照 `resetsAt` 为 UTC ISO 8601（测试显式断言，参照 codex-chatgpt.ts:147 的 epoch→ISO 转换）
  3. registry 集成用例：Claude 未配置时 `runConfiguredProviders()` 结果与现状完全一致（不产生任何 claude 键）
  4. provider 与 auth 模块对 `~/.claude`/Keychain 只读——代码零写调用（评审断言）且测试全程 mock 文件系统/子进程
  5. `npm run verify`、`npm run lint` 通过

**F003 · Kimi Code 订阅配额 provider · executor:generator ·（条件：F001 判 Kimi go；no-go 即砍）**
- 涉及文件：新建 `src/quota/kimi-auth.ts`（读 `~/.kimi-code/credentials/kimi-code.json`，键集按本机实测；`expires_at` 已过 → 视为未配置，不 refresh）、新建 `src/quota/kimi-code.ts`；修改 `src/quota/registry.ts:6`；新建 `tests/quota/kimi-auth.test.ts`、`tests/quota/kimi-code.test.ts`
- acceptance：
  1. `npx vitest run tests/quota/kimi-code.test.ts tests/quota/kimi-auth.test.ts` 全绿；覆盖同 F002 四象限 + **`expires_at` 过期→`isConfigured()===false`** 专项用例
  2. `resetsAt` UTC ISO 断言（同 F002.2）
  3. `tests/quota/registry.test.ts` 扩展用例：codex+kimi（或三家）同时配置→快照合并、单家失败→errors 按 provider.id 分键且不阻塞另一家
  4. 凭据文件只读、refresh_token 零使用（评审断言 + grep `refresh_token` 在 src/quota/ 零引用）
  5. `npm run verify`、`npm run lint` 通过

**F004 · SubscriptionCard 多 provider 泛化 + i18n · executor:generator ·（条件：F002/F003 至少一条存活）**
- 涉及文件：修改 `app/_components/subscription-card.tsx`（摘掉 :12 硬编码；抽 provider→展示配置的纯函数视图模型，建议新建 `app/_components/subscription-view.ts` 之类纯模块——repo 的既有模式是 app/ 零 UI 测试、抽纯逻辑配 vitest）；修改 `messages/en.json:411-432` 与 `messages/zh-CN.json` 对应段（新增 claude/kimi 标题、窗口标签、空态键）；新建 `tests/shared/subscription-view.test.ts`（目录按最终模块位置定）
- acceptance：
  1. 仅有 codex 快照时视图模型输出与现状语义一致（回归用例锁死：plan/credit/四个窗口行的取键不变）
  2. 存在 claude/kimi 快照 → 各渲染独立卡片/分节，窗口行复用 remaining% 条 + resetsAt（RateLimitRow 逻辑沿用 subscription-card.tsx:95-123）
  3. 未知 provider 的快照不致页面异常（视图模型用例：忽略或通用降级渲染，二选一并测死）
  4. en.json 与 zh-CN.json 新增键集 diff 为空（若 repo 无现成 i18n 键对齐测试——**未核**是否存在——则本 feature 顺带补一个键集对比用例）
  5. `npm run verify`、`npm run lint`、`npm run test` 全绿

## 数据模型 / migration

**无。** `QuotaSnapshot`（prisma/schema.prisma:231-250，已核）的 `provider/accountKey/windowKey` 均为自由 String，无枚举约束；索引 `[userId, provider, windowKey, capturedAt]` 对新 provider 直接生效。零 migration。

## API 与协议影响

- **endpoint：零新增零修改。** `/api/quota/snapshots/batch` 载荷 schema 不变（route.ts:8-21 已核，provider 自由字符串）；`getQuotaLatest` 泛型返回已支持任意 provider。
- **agent↔服务端协议：不动**（符合总原则 4）。新 provider 纯属 agent 端采集面扩展，上行走既有通道既有格式。
- **AGENT_FEATURE_VERSION：不 bump。** 理由：对照 `src/shared/agent-feature-version.ts:19-49` 的 1→9 判例，bump 全部对应「正确性/契约破坏」（旧 agent 会写坏数据或收不到控制面指令）；本批次旧 agent 只是**不上传**新 provider 快照，UI 自然缺席，无任何正确性问题——正是注释里「stragglers are acceptable, leave them alone」的情形。
- **升级可见性替代方案：** 在 `src/shared/agent-releases.json` 追加一条 release（现末项 1.2.1，已核），highlights 写明新增 provider。依据 cliagent 域报告（src/server/agent-version.ts:54-66 摘要，**未逐行核**）：release 落后会在设备页/汇总里给软性升级提示，但 `MIN_AGENT_FEATURE_VERSION` 不动即不拒绝旧 agent 写入。注意 `tests/shared/agent-release-version.test.ts` / `agent-release-i18n.test.ts` 可能需随账本追加同步更新（存在性已核，内容未核）。
- **部署触发（硬约束 1）：** `src/quota/**`、`app/**`、`messages/**`、`tests/**`、`src/shared/agent-releases.json` 均**不在** deploy-vps.yml paths-ignore（已核全表）→ **主批次每次 push main 即部署生产**。对策：F002-F004 各自独立 commit 但归拢成尽量少的 push 批；服务端实际变更面只有 SubscriptionCard + i18n（薄 UI），部署风险低。PROBE 子批次产物全走豁免目录（docs/test-reports、docs/test-cases），**零部署触发**。agent 端生效依赖用户重跑 install.sh（agent 无自更新，追 main HEAD），release 账本的软提示即为触达手段。

## 测试计划

| 文件 | 新/改 | 关键用例 |
|---|---|---|
| `tests/quota/claude-auth.test.ts` | 新 | 凭据缺失/JSON 坏/Keychain 探测失败 → null；per-OS 分支 mock |
| `tests/quota/claude-code.test.ts` | 新 | 200→窗口映射（含 resetsAt UTC 断言）；401/5xx/超时→error 不 throw；未配置→静默跳过 |
| `tests/quota/kimi-auth.test.ts` | 新 | 键集解析；`expires_at` 过期→null；refresh_token 不使用 |
| `tests/quota/kimi-code.test.ts` | 新 | 同 claude-code 四象限 |
| `tests/quota/registry.test.ts`（现 78 行） | 改 | 多 provider 并存合并快照；单家 fetch 抛错→errors["<id>"] 且他家照常（registry.ts:33-38 路径） |
| `tests/shared/subscription-view.test.ts`（或组件同级） | 新 | codex-only 回归锁定；多 provider 渲染模型；未知 provider 降级；en/zh 键集对齐 |
| `tests/shared/agent-release-*.test.ts` | 视情改 | 账本追加后保持全绿（具体断言内容未核） |

现有 `tests/quota/` 三件（auth-file 72 / codex-chatgpt 137 / registry 78 行，已核）是新测试的直接模板。全量门槛：`npm run test` + `npm run verify` + `npm run lint`。

## 依赖与前置

- **前置：无硬依赖批次。** 与中期其它批次（BL-DEVICE-DECOUPLE、BL-LIVE-SESSION 等）无文件面冲突（quota 域目录独立）。内部前置：F001 → F002/F003 → F004（故建议 PROBE 子批次先行）。
- **被依赖：** BL-BUDGET 的「quota 逼近提醒」（roadmap §3.2 P0）消费 QuotaSnapshot——本批次扩大其数据面但不构成 BL-BUDGET 的阻塞前置；后续更多 provider 批次复用 F004 的泛化 UI。

## 风险与对策

1. **Claude 凭据在 macOS 不落盘（本机实测确认）**——Keychain 非交互读取若触发授权弹窗，后台 launchd daemon 每 60s 弹一次是灾难。对策：F001 把「非 TTY 实测」列为 go/no-go 单点判据；弹窗不可避免则 macOS 上 Claude provider 直接优雅缺席（`isConfigured()===false`），或整条砍掉只留 Linux——**方案预设 Claude 是两家中更可能 no-go 的一家**。
2. **非官方端点脆弱**——codex-chatgpt 打 `chatgpt.com/backend-api` 已是仓内接受的同类先例；端点变更/加防护时 fail-quiet 链路（error 分键 → `quotaAuthErrors.consecutiveFailures` → 卡片过期）保证只是数据缺席不是故障。对策：10s 超时照抄、错误不 throw 照抄、UI 对缺席 provider 零假设。
3. **双 no-go 使批次缩水至零**——预案明说：此时 F002-F004 全砍，PROBE 报告本身即交付物（把「不可行」钉成有依据的机构记忆），主批次取消并把结论回写 backlog。
4. **push 即部署**——见协议节对策；另外 PROBE 阶段任何探针代码不得进非豁免目录。
5. **token 过期噪音**——Kimi `expires_at` 过期后若仍尝试请求会制造持续 401 噪音；对策：过期判定放在 `isConfigured()`（静默跳过），而非 fetch 后报错。
6. **UI 回归**——codex 用户的现有卡片是唯一存量体验；对策：F004.1 的回归锁定用例先行（视图模型快照），再动渲染层。

## 规模估计

**M**。feature 数 4（调研后可能收缩至 2-3）。主要涉及文件 ~13：新建 8（2 auth + 2 provider + 4 测试）+ 修改 5（registry.ts、subscription-card.tsx、messages/en.json、messages/zh-CN.json、agent-releases.json）+ 视图模型抽取 1-2 个新模块；另有 PROBE 子批次的 1 份报告 + 探针产物（豁免目录）。不确定性主要集中在 F001 结论对范围的裁剪幅度——这是设计使然，不是估计误差。