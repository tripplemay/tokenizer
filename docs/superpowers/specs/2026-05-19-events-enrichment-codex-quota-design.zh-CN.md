# 事件字段补全 (A) + Codex 订阅配额可见化 (B-Codex 切片)

**日期：** 2026-05-19
**状态：** 已批准（待 spec 审阅）
**英文版：** [2026-05-19-events-enrichment-codex-quota-design.md](./2026-05-19-events-enrichment-codex-quota-design.md)

## 问题陈述

对照 openusage 调研 PRD 时浮现两个问题：

1. **Claude parser 丢弃了与计费相关的字段。** `src/parsers/claude.ts`
   忽略了 `cache_creation.ephemeral_5m_input_tokens` /
   `ephemeral_1h_input_tokens`（Claude 4.x 缓存定价细分）、
   `server_tool_use.web_search_requests` / `web_fetch_requests`
   （按次计费的 web 工具调用），以及 `service_tier`
   （"standard" / "priority" / "batch"）。这些字段已存在于 JSONL 文件中
   ——我们只是没读它们。

2. **看不到 ChatGPT/Codex 订阅状态。** 用户（特别是 `hanteenwong@outlook.com`
   有 39k Codex 事件、`tripplezhou` 有 28k）无法看到 plan tier、信用余额、
   速率限制窗口、重置时间。openusage 通过本机 `~/.codex/auth.json` 里的
   access token 调 `chatgpt.com/backend-api` 拿这些数据。

本 spec 结合 PRD-A（jsonl 字段补全）与 PRD-B 的 **Codex 切片**（配额快照），
把 Claude Web 的 paste-cookie 流程推迟到下一轮。

生产用户分布证实两半都服务真实用户：

| 用户 | claude-code | codex | opencode |
|---|---:|---:|---:|
| tripplezhou | 112,666 | 27,950 | 2,357 |
| hanteenwong | 6,332 | 39,332 | 0 |

## 目标

- 把 5 个缺失的 Claude JSONL 字段捕获进 `UsageEvent`，schema 前向兼容
  （nullable / 0-默认）。
- 在 `/events` 页面把 `service_tier` 显示成 model 列旁的彩色徽章
  （priority 橙、batch 灰、standard 隐藏）。
- 新增 `QuotaSnapshot` 表（append-only）和单一 Codex provider 模块，
  读 `~/.codex/auth.json` 并拉取 chatgpt.com。
- Agent 主循环每 60s（活跃）/ 300s（空闲）刷新 Codex 配额。
- 首页 hero 行和 KPI 行之间新增"订阅状态"卡片行，三种状态：已连接 /
  未配置 CTA / 数据陈旧。

## 不在范围内

- Claude Web provider、`tokenizer auth login` CLI、paste 流程、
  cookie-钓鱼缓解措施
- web_search / web_fetch 按次计费纳入成本公式（数据捕获，公式不动）
- 按 service-tier 维度拆分的成本图表
- 历史事件回填
- 多设备 polling 协调
- `quotaAuthErrors` 在 UI 中显示（仅本地捕获）
- "重新连接" 横幅 / `/api/quota/latest` 的 `errors[]` 字段
- Cursor / Copilot / Gemini / OpenRouter / Anthropic Console API 配额

## 架构

两条几乎独立的管道，只共享 DB schema migration 和身份认证边界：

```
A —— Claude parser 字段补全
  Claude Code JSONL → parsers/claude.ts → ingest.ts → UsageEvent (5 新列)
                                                          ↓
                                          /events 页 → TierPill 徽章

B-Codex —— 订阅状态采集
  Agent tick (60s/300s) → src/quota/codex-chatgpt.ts → POST /api/quota/snapshots/batch
                                                          ↓
                                                     QuotaSnapshot (append-only)
                                                          ↓
                                  SubscriptionCard ← GET /api/quota/latest (DISTINCT ON)
```

**两个独立的 Prisma migration** 同一次 deploy 应用：A 先（时间戳
`20260519100000`），B-Codex 后（`20260519200000`）。每个 migration 的
回滚单元更小。

## Schema

### A —— `UsageEvent` 新增 5 列

```prisma
model UsageEvent {
  // ... 现有字段 ...
  cacheEphemeral5mInputTokens Int     @default(0)
  cacheEphemeral1hInputTokens Int     @default(0)
  webSearchRequests           Int     @default(0)
  webFetchRequests            Int     @default(0)
  serviceTier                 String?
}
```

Migration `prisma/migrations/20260519100000_add_jsonl_enrichment_fields/migration.sql`：

```sql
ALTER TABLE "UsageEvent" ADD COLUMN "cacheEphemeral5mInputTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UsageEvent" ADD COLUMN "cacheEphemeral1hInputTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UsageEvent" ADD COLUMN "webSearchRequests" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UsageEvent" ADD COLUMN "webFetchRequests" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UsageEvent" ADD COLUMN "serviceTier" TEXT;
```

类型理由：计数字段用 `Int NOT NULL DEFAULT 0`，这样 SUM/COUNT 聚合
不需要 COALESCE；`serviceTier` 用 `TEXT NULL`，因为"未知 tier"和
"standard tier"是两个不同的概念。

### B-Codex —— 新增 `QuotaSnapshot` 表

```prisma
model QuotaSnapshot {
  id           String    @id @default(cuid())
  userId       String
  provider     String    // "codex-chatgpt"
  accountKey   String
  windowKey    String    // 参见下文 §7
  utilization  Decimal?  @db.Decimal(6, 4)
  usedRaw      BigInt?
  limitRaw     BigInt?
  unit         String?
  resetsAt     DateTime?
  capturedAt   DateTime  @default(now())
  capturedBy   String?
  rawJson      Json?

  user   User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  device Device? @relation(fields: [capturedBy], references: [id], onDelete: SetNull)

  @@index([userId, provider, windowKey, capturedAt])
}
```

外加 `User` 和 `Device` 反向关系 `quotaSnapshots QuotaSnapshot[]`。

Migration `prisma/migrations/20260519200000_add_quota_snapshot_table/migration.sql`：

```sql
CREATE TABLE "QuotaSnapshot" (
  "id"            TEXT PRIMARY KEY,
  "userId"        TEXT NOT NULL,
  "provider"      TEXT NOT NULL,
  "accountKey"    TEXT NOT NULL,
  "windowKey"     TEXT NOT NULL,
  "utilization"   DECIMAL(6,4),
  "usedRaw"       BIGINT,
  "limitRaw"      BIGINT,
  "unit"          TEXT,
  "resetsAt"      TIMESTAMP(3),
  "capturedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "capturedBy"    TEXT,
  "rawJson"       JSONB,
  CONSTRAINT "QuotaSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "QuotaSnapshot_capturedBy_fkey" FOREIGN KEY ("capturedBy") REFERENCES "Device"("id") ON DELETE SET NULL
);

CREATE INDEX "QuotaSnapshot_userId_provider_windowKey_capturedAt_idx"
  ON "QuotaSnapshot" ("userId", "provider", "windowKey", "capturedAt");
```

索引支持 `SELECT DISTINCT ON (provider, windowKey) ... ORDER BY
provider, windowKey, capturedAt DESC`——即 §服务端 API 中"每窗口最新值"
查询模式。

## CLI 客户端改动

### Claude parser（A）

`src/shared/usage.ts` 扩展 `UsageEventInput`：

```ts
cacheEphemeral5mInputTokens?: number;
cacheEphemeral1hInputTokens?: number;
webSearchRequests?: number;
webFetchRequests?: number;
serviceTier?: string | null;
```

`src/parsers/claude.ts` 的 `parseProjectJsonl` 在现有的 `cacheCreation` /
`cacheRead` 提取之后增加：

```ts
const cacheCreationDetail = (usage.cache_creation ?? {}) as Record<string, unknown>;
const cacheEphemeral5m = normalizeTokenCount(cacheCreationDetail.ephemeral_5m_input_tokens);
const cacheEphemeral1h = normalizeTokenCount(cacheCreationDetail.ephemeral_1h_input_tokens);

const serverToolUse = (usage.server_tool_use ?? {}) as Record<string, unknown>;
const webSearchRequests = normalizeTokenCount(serverToolUse.web_search_requests);
const webFetchRequests = normalizeTokenCount(serverToolUse.web_fetch_requests);

const serviceTier = typeof usage.service_tier === "string" ? usage.service_tier : null;
```

字段塞进现有的 `events.push({ ... })` payload。

**实施前先 grep**：实施者在 tripplezhou 的本机 grep
`~/.claude/projects/**/*.jsonl` 里有没有 `ephemeral`，确认字段存在于
当前 Claude Code 输出。如果没有，PR 里写明（更老的 Claude 版本）但仍然
ship——旧数据存 0，新数据随着 Claude 升级自然填充。

### Codex 配额 provider（B-Codex）

新目录 `src/quota/`：

- `types.ts` —— `QuotaSnapshotInput`、`QuotaProvider` 接口
- `auth-file.ts` —— 只读访问 `~/.codex/auth.json`（不写入）
- `codex-chatgpt.ts` —— 单一 provider，调 chatgpt.com/backend-api
- `registry.ts` —— `runConfiguredProviders()` 遍历所有 provider
- `run.ts` —— `runQuotaRefresh()` agent 主循环入口
- `sync.ts` —— `syncQuotaSnapshots()` POST 到服务端，模仿
  `src/cli/sync.ts:syncEvents`

`src/quota/codex-chatgpt.ts` 框架（具体字段路径由实施者读 openusage 的
`internal/providers/codex/codex.go` + `live_usage.go` 确认）：

```ts
const CHATGPT_BASE = "https://chatgpt.com/backend-api";

export const codexChatgptProvider: QuotaProvider = {
  id: "codex-chatgpt",
  async isConfigured() {
    return readCodexAuthFile()?.tokens?.accessToken != null;
  },
  async fetch(): Promise<QuotaProviderResult> {
    const auth = readCodexAuthFile();
    const token = auth?.tokens?.accessToken;
    if (!token) return { snapshots: [], accountKey: null, error: { code: "no_auth", message: "Codex auth.json missing" } };

    const response = await fetch(`${CHATGPT_BASE}/<TBD-by-implementer>`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "user-agent": `tokenizer-cli/${process.env.TOKENIZER_VERSION ?? "dev"}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return { snapshots: [], accountKey: auth.accountId ?? null, error: { code: response.status, message: await response.text() } };

    const data = await response.json() as ChatGptUsageResponse;
    return {
      snapshots: mapResponseToSnapshots(data),
      accountKey: data.account_id ?? auth.accountId ?? "unknown",
    };
  },
};
```

响应 → 快照映射表（按 openusage `codex.go` 里的 `usagePayload` 结构）：

| 响应路径 | `windowKey` | `utilization` | `resetsAt` | `unit` |
|---|---|---|---|---|
| `plan_type` | `plan` | — | — | `label`（label 存 rawJson） |
| `rate_limit.primary_window` | `rate_limit_primary` | used_percent / 100 | resets_at | `percent` |
| `rate_limit.secondary_window` | `rate_limit_secondary` | 同上 | 同上 | `percent` |
| `code_review_rate_limit.primary_window` | `code_review_rate_limit_primary` | 同上 | 同上 | `percent` |
| `code_review_rate_limit.secondary_window` | `code_review_rate_limit_secondary` | 同上 | 同上 | `percent` |
| `credits.balance`（若 `has_credits`） | `credit_balance` | unlimited 时 0、其他 — | — | `usd` |
| `additional_rate_limits[i]` | `additional_rate_limit_<i>` | 同上 | 同上 | `percent` |

`auth-file.ts` 在 `~/.codex/auth.json` 缺失或解析失败时静默返回
null —— `isConfigured()` 因此返回 false，registry 跳过此 provider。

### Agent 主循环集成

`src/cli/agent.ts`：

- 新调度参数：`quotaRefreshSeconds: { active: 60, idle: 300 }`
- 跟踪 `lastQuotaRefreshAt`、`lastEventActivityAt`（每次 `runOnce`
  采集到 ≥1 个新事件时刷新）
- 活跃条件：`Date.now() - lastEventActivityAt < 1h`
- 每个 tick 比较 `now - lastQuotaRefreshAt` 与活跃/空闲阈值；超时则
  调 `runQuotaRefresh()`
- `runOnce()` 末尾也调一次 `runQuotaRefresh()`（single-flight）——
  让 cron 模式用户也能获得 sync 节奏的覆盖

`src/cli/config.ts` 的 `updateState` 扩展 `state.json` 结构：

```ts
lastQuotaRefreshAt?: string;
lastQuotaRefreshStatus?: "success" | "failed";
quotaAuthErrors?: Record<string, { code: number | string; lastFailedAt: string; consecutiveFailures: number }>;
```

`quotaAuthErrors` 写入本地用于法证排查；**v1 不在 UI 中显示**。

## 服务端 API

### POST /api/usage/events/batch —— 扩展（A）

现有 handler 在 `app/api/usage/events/batch/route.ts` 不变，因为字段
映射发生在 `ingestUsageEvents` 里。`src/server/ingest.ts:136` 的
`rows.map` 增加 5 个字段：

```ts
cacheEphemeral5mInputTokens: normalizeTokenCount(event.cacheEphemeral5mInputTokens),
cacheEphemeral1hInputTokens: normalizeTokenCount(event.cacheEphemeral1hInputTokens),
webSearchRequests: normalizeTokenCount(event.webSearchRequests),
webFetchRequests: normalizeTokenCount(event.webFetchRequests),
serviceTier: sanitizeNullableString(event.serviceTier ?? null),
```

`normalizeTokenCount(undefined) === 0`；`sanitizeNullableString(null) === null`。
老 CLI 不发新字段时一切走默认值，向后兼容。

### POST /api/quota/snapshots/batch —— 新（B-Codex）

`app/api/quota/snapshots/batch/route.ts`。认证：device-token bearer。

Body：

```ts
{
  device?: { id: string; name?: string };
  snapshots: Array<{
    provider: string;
    accountKey: string;
    windowKey: string;
    utilization?: number;
    usedRaw?: number;
    limitRaw?: number;
    unit?: string;
    resetsAt?: string;
    rawJson?: unknown;
  }>;
}
```

若 body 含 `device`，校验 `body.device.id === token.deviceId`。映射到
`QuotaSnapshot.createMany`，`capturedBy = token.deviceId`。无 dedup
—— 每次调用都 append。

响应：`{ received, inserted }`。

### GET /api/quota/latest —— 新（B-Codex）

`app/api/quota/latest/route.ts`。认证：用户 session。

使用共享 helper `src/server/quota.ts:getQuotaLatest(userId)`：

```ts
const rows = await prisma.$queryRaw<LatestRow[]>`
  SELECT DISTINCT ON (q."provider", q."windowKey")
    q."provider", q."windowKey", q."accountKey",
    q."utilization", q."usedRaw", q."limitRaw", q."unit",
    q."resetsAt", q."capturedAt", q."capturedBy",
    d."name" AS "deviceName"
  FROM "QuotaSnapshot" q
  LEFT JOIN "Device" d ON d."id" = q."capturedBy"
  WHERE q."userId" = ${userId}
  ORDER BY q."provider", q."windowKey", q."capturedAt" DESC
`;
```

分组为：

```ts
{
  byProvider: Record<string, {
    accountKey: string;
    capturedAt: string;          // 所有窗口里最新的
    capturedBy: { id: string; name: string | null } | null;
    windows: Array<{ windowKey: string; utilization: number | null; usedRaw: number | null; limitRaw: number | null; unit: string | null; resetsAt: string | null }>;
  }>;
}
```

用 `unstable_cache` 包装，30 秒 revalidate（与 summaries 一致）。
缓存 key 自动包含 `userId`。route 文件和 `SubscriptionCard` server
component 都 import `getQuotaLatest`——单一来源。

## 浏览器 UI

### `/events` service_tier 徽章（A）

新文件：`app/_components/tier-pill.tsx`

```tsx
const colorByTier: Record<string, string> = {
  priority: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300",
  batch:    "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300",
};

export function TierPill({ tier }: { tier: string | null | undefined }) {
  if (!tier || tier === "standard") return null;
  const color = colorByTier[tier] ?? "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {tier}
    </span>
  );
}
```

`/events` 表里 model 名旁内联显示：

```tsx
<td>
  <span className="inline-flex items-center gap-1.5">
    {event.model ?? t("events.unknownModel")}
    <TierPill tier={event.serviceTier} />
  </span>
</td>
```

不增加新列——徽章贴在 model 名后面，保持表格现有 11 列布局。standard
tier 隐藏 = 67k codex 和 2k opencode 事件不会有空白徽章占位。

独立组件（而不是扩展 `SourcePill`）的理由：`SourcePill` 接收 source
枚举（claude-code / codex / ...），`TierPill` 接收另一个语义维度。混在
一起会让 SourcePill 同时承担两件事。

### 首页订阅卡（B-Codex）

新文件：`app/_components/subscription-card.tsx` —— async server
component。

```tsx
export async function SubscriptionCard({ userId }: { userId: string }) {
  const t = await getTranslations();
  const tz = await getUserTimezone(userId);
  const latest = await getQuotaLatest(userId);
  const codex = latest.byProvider["codex-chatgpt"];

  if (!codex) {
    return <EmptyStateCard t={t} />;  // "未检测到 Codex CLI" + 安装文档链接
  }
  return <ConnectedCard codex={codex} t={t} tz={tz} />;
}
```

`ConnectedCard` 布局：

```
┌────────────────────────────────────────────────────────┐
│ ⚡ Codex / ChatGPT     ·    Plus tier        $4.85   │
│                                              余额    │
│   rate limit primary   ████▀▀▀▀▀▀▀▀▀ 35%   2h 后重置│
│   rate limit secondary ██▀▀▀▀▀▀▀▀▀▀▀ 18%   6h 后重置│
│   code review primary  █████████████ 92%   1h 后重置│
│                                                       │
│ 由设备 hanteen-mbp · 30 秒前刷新                      │
└────────────────────────────────────────────────────────┘
```

进度条颜色阶梯：< 70% brand-500（紫）、70–89% amber-500（黄）、
≥ 90% red-500。给用户一眼能扫到的"快用完了"信号。

`EmptyStateCard`：

```
┌────────────────────────────────────────────────────────┐
│ ⚡ 订阅状态                                            │
│                                                       │
│ 未检测到 Codex CLI。                                   │
│ 安装后这里会显示你的 ChatGPT 订阅状态。                │
│                                                       │
│ [查看安装文档 →]                                       │
└────────────────────────────────────────────────────────┘
```

两种状态卡渲染同等大小；用户装上 Codex 后首页布局不会跳动。

`formatRelativeTime(value, t, tz)` 和 `formatUsd(value)` 来自
`@/shared/format`——复用本周早些时候上线的时区工作。

### 首页布局接入

`app/page.tsx` 在现有 hero 行和 KPI 行之间插入
`<SubscriptionCard userId={tenantId} />`，包在 `Suspense` 里。
fallback 是一个 16rem 高的脉冲矩形 skeleton。

### i18n keys（zh-CN + en，两份都加）

新增顶层 `subscription` 命名空间：

```json
"subscription": {
  "title": "订阅状态",
  "codex": {
    "title": "Codex / ChatGPT",
    "planLabel": "{plan} tier",
    "creditBalance": "余额",
    "ratePrimary": "速率限制（主窗口）",
    "rateSecondary": "速率限制（副窗口）",
    "codeReviewPrimary": "Code Review 主窗口",
    "codeReviewSecondary": "Code Review 副窗口",
    "resetsIn": "{time}后重置"
  },
  "empty": {
    "title": "未检测到 Codex CLI",
    "hint": "安装后这里会显示你的 ChatGPT 订阅状态",
    "installLink": "查看安装文档"
  },
  "footer": {
    "viaDevice": "由设备 {device}·{ago}前刷新",
    "refreshed": "{ago}前刷新"
  }
}
```

英文版镜像：`"Subscription status"` / `"Codex / ChatGPT"` /
`"{plan} tier"` / `"Credit balance"` / `"Rate limit (primary)"` 等。

## 边界情况与错误处理

**A 管道：**

- 老 CLI 不发新字段 → `undefined` → `0` / `null` 默认值
- Anthropic 改 JSONL shape → `?.` 链兜底；缺失字段保持默认；不抛错
- `service_tier` 出现未识别值（未来新增 "enterprise" tier）→
  `TierPill` 渲染 fallback 灰色 + 显示原始字面值
- 不变式违反（5m + 1h > cacheWrite）→ parser 写 warning、保留原值、
  不抛错

**B-Codex 管道：**

- `~/.codex/auth.json` 不存在 → `isConfigured()` 返回 false → 跳过此
  provider、不调 HTTP、不写库 → 订阅卡显示 empty state
- `access_token` 失效（401 / 403）→ provider 返回 error；不写库；
  **既有 QuotaSnapshot 行保持权威** → 订阅卡显示最后一次成功的数据 +
  陈旧的 `capturedAt`
- 10 秒网络超时 via `AbortSignal.timeout()` → 同上
- 响应 shape 改变 → `?.` 容错；能识别的字段照存；未知字段保留在
  `rawJson` 用于法证排查
- 响应缺 `account_id` → 退到 `auth.json.accountId` → 再退到 `"unknown"`
  字面值。永远非 NULL（DB 列 NOT NULL）
- 首次访问（agent 还没跑过 quota tick）→ byProvider 是空 → empty
  state 卡；60 秒内第一次刷新后填充。这是已知 UX 摩擦，可以未来加
  "采集中…" 状态。v1 接受
- 多设备 polling → `DISTINCT ON (capturedAt DESC)` 解析到最近一台
  设备的写入；用户看到 `capturedBy` 在多个设备名间切换。v1 接受

**错误日志：**

- Parser 不变式 warning：通过现有 `warnings: string[]` 返回通道收集；
  agent 主循环写到 `~/.tokenizer/logs/agent.log`
- Provider fetch 错误：走同一通道
- 连续 3 次 provider 失败：`quotaAuthErrors[provider]` 写入
  `state.json`。未来工具读取（如下一轮的重连横幅）；v1 不在 UI 显示

## 测试策略

无 React 组件测试基建。验证手段：

1. `npm run verify` —— prisma generate + `tsc --noEmit` 退出 0
2. `npm run test` —— 新增 vitest 用例如下

Vitest 用例：

`tests/parsers/claude.test.ts`（扩展）：

- 合成 JSONL 行含所有 5 个新字段被填充 → 断言正确提取到
  `UsageEventInput`
- 合成 JSONL 行 5 字段全缺 → 断言 `0 / 0 / 0 / 0 / null`
- 违反不变式的输入 → 断言 parser 返回 warnings，事件仍然产生

`tests/quota/auth-file.test.ts`：

- 文件存在、合法 JSON → 返回 camelCase 形状
- 文件不存在 → 返回 null（不抛）
- 合法 JSON 解析失败 → 返回 null（不抛）

`tests/quota/codex-chatgpt.test.ts`：

- mock 200 + fixture 响应（fixture 从 openusage 测试中脱敏存到
  `tests/fixtures/codex-chatgpt-response.json`）→ 断言每个 windowKey
  对应的 snapshot 行
- mock 401 → 返回 `{ snapshots: [], error: { code: 401 } }`
- mock 超时 → 返回 error、不抛
- 响应 `credits.unlimited: true` → snapshot.utilization = 0、
  rawJson.unlimited = true
- 响应缺 `account_id` → 退到 `auth.json.accountId`

`tests/quota/registry.test.ts`：

- 一个 configured + 一个未 configured → 只跑前者
- 一个 provider 抛错 → 其他 provider 不受影响
- result 的 `accountKey` 流到每个 snapshot

`tests/server/quota-batch.test.ts`（尽力做，若有可循的现有 batch
模式）：

- 5 个合法 snapshots → inserted = 5
- 错位的 device.id → 403
- 空数组 → 200、inserted = 0

**手动冒烟（交给你做）：**

1. `npm run dev` → 首页。你和 hanteen 都装了 Codex —— 订阅卡应在
   agent 跑过的 60 秒内填充
2. `mv ~/.codex/auth.json ~/.codex/auth.json.bak`；重启 agent → 下次
   刷新：卡片翻转到 empty state
3. 恢复 auth.json 但故意把 access_token 改坏一位 → 401 → 卡片保留旧
   数据，footer 显示 "N 分钟前刷新"（明显陈旧）
4. 访问 `/events` → priority tier 的 Claude 事件在 model 名旁显示
   橙色 pill；codex / opencode 事件不显示

## 文件清单

**新增（10 个文件）：**

A：

- `prisma/migrations/20260519100000_add_jsonl_enrichment_fields/migration.sql`

B-Codex：

- `prisma/migrations/20260519200000_add_quota_snapshot_table/migration.sql`
- `src/quota/types.ts`
- `src/quota/auth-file.ts`
- `src/quota/codex-chatgpt.ts`
- `src/quota/registry.ts`
- `src/quota/run.ts`
- `src/quota/sync.ts`
- `src/server/quota.ts`（服务端 helper，API route + RSC 共享）
- `app/api/quota/snapshots/batch/route.ts`
- `app/api/quota/latest/route.ts`
- `app/_components/tier-pill.tsx`
- `app/_components/subscription-card.tsx`
- `tests/quota/auth-file.test.ts`
- `tests/quota/codex-chatgpt.test.ts`
- `tests/quota/registry.test.ts`
- `tests/fixtures/codex-chatgpt-response.json`

**修改：**

A：

- `prisma/schema.prisma`（UsageEvent +5 列）
- `src/shared/usage.ts`（UsageEventInput +5 可选字段）
- `src/parsers/claude.ts`（`parseProjectJsonl` 多读 5 字段）
- `src/server/ingest.ts`（`rows.map` 多映射 5 字段）
- `app/events/page.tsx`（model 名旁加 TierPill）
- `tests/parsers/claude.test.ts`（扩展 3 个新用例）

B-Codex：

- `prisma/schema.prisma`（加 QuotaSnapshot + User/Device 反向关系）
- `src/cli/agent.ts`（quota tick 调度）
- `src/cli/config.ts`（state.json 字段）
- `app/page.tsx`（hero 和 KPI 之间挂载 SubscriptionCard）
- `messages/zh-CN.json`（subscription 命名空间，~10 个 keys）
- `messages/en.json`（镜像）

**未改但已验证无影响：**

- `app/api/usage/events/batch/route.ts` —— body 透传给
  `ingestUsageEvents`；实际字段映射在 `ingest.ts` 里
- `src/auth.ts`、`src/server/auth-session.ts` —— 无认证改动
- `app/admin-shell.tsx` —— 无布局壳改动（前一轮的 timezone reporter
  保持原位）

## 实施开放说明

- **chatgpt.com 端点路径由实施者确认。** PRD-B §13 已提及；openusage
  的 `internal/providers/codex/live_usage.go`（本轮 brainstorm 没读
  完）是权威参考。实施者第一步是从
  `github.com/janekbaraniewski/openusage` 拉这个文件，确认 URL +
  响应 shape。如果 shape 与本 spec 引用的 `codex.go` 已经漂移，
  **就地更新本 spec 后再开始写代码**。
- **JSONL grep 先行（A）：** 实施者在 tripplezhou 本机 grep 一份真实的
  `~/.claude/projects/**/*.jsonl` 查 `ephemeral_5m` 和 `service_tier`
  存在性。如果当前 Claude Code 输出没有，代码仍然 ship（前向兼容）但
  在 PR 里写明这个观察。
- **无 `unstable_cache` 失效计划**：agent 的配额刷新不会主动失效
  `/api/quota/latest` 的 30s 缓存。用户最多看到 30s 陈旧——可接受。
