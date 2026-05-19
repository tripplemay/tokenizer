# Events Enrichment (A) + Codex Subscription Quota (B-Codex slice)

**Date:** 2026-05-19
**Status:** Approved (pending spec review)

## Problem

Two issues surfaced during PRD review against openusage:

1. **Claude parser drops billing-relevant fields.** `src/parsers/claude.ts`
   ignores `cache_creation.ephemeral_5m_input_tokens` /
   `ephemeral_1h_input_tokens` (Claude 4.x cache pricing tiers),
   `server_tool_use.web_search_requests` / `web_fetch_requests` (per-request
   billing), and `service_tier` ("standard" / "priority" / "batch"). All
   exist in the JSONL already — we just don't read them.

2. **No visibility into ChatGPT/Codex subscription state.** Users (notably
   `hanteenwong@outlook.com` with 39k Codex events, and `tripplezhou` with
   28k) cannot see plan tier, credit balance, rate-limit windows, or
   reset-at times. openusage reads these from `chatgpt.com/backend-api`
   using the local `~/.codex/auth.json` access token.

This spec combines PRD-A (jsonl enrichment) with the **Codex slice** of
PRD-B (quota snapshot), deferring Claude Web's paste-cookie flow to a
later round.

Production user mix confirms both halves serve real users:

| User | claude-code | codex | opencode |
|---|---:|---:|---:|
| tripplezhou | 112,666 | 27,950 | 2,357 |
| hanteenwong | 6,332 | 39,332 | 0 |

## Goals

- Capture all 5 missing Claude JSONL fields into `UsageEvent` with
  forward-only nullable / 0-default schema.
- Surface `service_tier` as a colored pill next to the model column on
  `/events` (priority = orange, batch = gray, standard hidden).
- New `QuotaSnapshot` table (append-only) and a single Codex provider
  module that reads `~/.codex/auth.json` and polls chatgpt.com.
- Agent main loop refreshes Codex quota every 60s active / 300s idle.
- New home-page "Subscription Status" card row between hero and KPI
  rows, with three states: connected / not-configured CTA / stale data.

## Non-Goals

- Claude Web provider, `tokenizer auth login` CLI, paste flow,
  cookie-phishing mitigations.
- Per-request `web_search` cost re-computation (data captured, math
  unchanged).
- Service-tier-dimensioned cost breakdown charts.
- Historical event backfill.
- Multi-device polling coordination.
- `quotaAuthErrors` surfacing in the UI (data captured locally only).
- A reconnect banner / `/api/quota/latest` `errors[]` field.
- Cursor / Copilot / Gemini / OpenRouter / Anthropic Console API quota.

## Architecture

Two largely-independent pipelines that share only the DB schema migration
and authn boundaries:

```
A — Claude parser enrichment
  Claude Code JSONL → parsers/claude.ts → ingest.ts → UsageEvent (5 new cols)
                                                          ↓
                                          /events page → TierPill badge

B-Codex — Subscription state capture
  Agent tick (60s/300s) → src/quota/codex-chatgpt.ts → POST /api/quota/snapshots/batch
                                                          ↓
                                                     QuotaSnapshot (append-only)
                                                          ↓
                                  SubscriptionCard ← GET /api/quota/latest (DISTINCT ON)
```

**Two separate Prisma migrations** ship in the same deploy: A first
(timestamp `20260519100000`), B-Codex second (`20260519200000`). Smaller
rollback unit per migration.

## Schema

### A — `UsageEvent` adds 5 columns

```prisma
model UsageEvent {
  // ... existing fields ...
  cacheEphemeral5mInputTokens Int     @default(0)
  cacheEphemeral1hInputTokens Int     @default(0)
  webSearchRequests           Int     @default(0)
  webFetchRequests            Int     @default(0)
  serviceTier                 String?
}
```

Migration `prisma/migrations/20260519100000_add_jsonl_enrichment_fields/migration.sql`:

```sql
ALTER TABLE "UsageEvent" ADD COLUMN "cacheEphemeral5mInputTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UsageEvent" ADD COLUMN "cacheEphemeral1hInputTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UsageEvent" ADD COLUMN "webSearchRequests" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UsageEvent" ADD COLUMN "webFetchRequests" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UsageEvent" ADD COLUMN "serviceTier" TEXT;
```

Type rationale: counts are `Int NOT NULL DEFAULT 0` so SUM/COUNT
aggregations don't need COALESCE; `serviceTier` is `TEXT NULL` because
"unknown tier" and "standard tier" are distinct concepts.

### B-Codex — new `QuotaSnapshot` table

```prisma
model QuotaSnapshot {
  id           String    @id @default(cuid())
  userId       String
  provider     String    // "codex-chatgpt"
  accountKey   String
  windowKey    String    // see §7
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

Plus reverse relations `quotaSnapshots QuotaSnapshot[]` on `User` and
`Device`.

Migration `prisma/migrations/20260519200000_add_quota_snapshot_table/migration.sql`:

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

Index supports `SELECT DISTINCT ON (provider, windowKey) ... ORDER BY
provider, windowKey, capturedAt DESC` — the latest-per-window query
pattern in §6.3.

## CLI client changes

### Claude parser (A)

`src/shared/usage.ts` extends `UsageEventInput`:

```ts
cacheEphemeral5mInputTokens?: number;
cacheEphemeral1hInputTokens?: number;
webSearchRequests?: number;
webFetchRequests?: number;
serviceTier?: string | null;
```

`src/parsers/claude.ts` `parseProjectJsonl` extracts the new fields
after the existing `cacheCreation` / `cacheRead` extraction:

```ts
const cacheCreationDetail = (usage.cache_creation ?? {}) as Record<string, unknown>;
const cacheEphemeral5m = normalizeTokenCount(cacheCreationDetail.ephemeral_5m_input_tokens);
const cacheEphemeral1h = normalizeTokenCount(cacheCreationDetail.ephemeral_1h_input_tokens);

const serverToolUse = (usage.server_tool_use ?? {}) as Record<string, unknown>;
const webSearchRequests = normalizeTokenCount(serverToolUse.web_search_requests);
const webFetchRequests = normalizeTokenCount(serverToolUse.web_fetch_requests);

const serviceTier = typeof usage.service_tier === "string" ? usage.service_tier : null;
```

Fields land in the existing `events.push({ ... })` payload.

**Pre-implementation check**: implementer greps a real
`~/.claude/projects/**/*.jsonl` on `tripplezhou`'s machine for
`ephemeral` to confirm the field exists in current Claude Code output.
If absent, document in the PR (older Claude version) but ship anyway —
old data is `0`, new data populates as Claude updates.

### Codex quota provider (B-Codex)

New directory `src/quota/`:

- `types.ts` — `QuotaSnapshotInput`, `QuotaProvider` interface
- `auth-file.ts` — read-only access to `~/.codex/auth.json` (no writes)
- `codex-chatgpt.ts` — single provider hitting chatgpt.com/backend-api
- `registry.ts` — `runConfiguredProviders()` that iterates all providers
- `run.ts` — `runQuotaRefresh()` agent main-loop entry point
- `sync.ts` — `syncQuotaSnapshots()` POSTs to server, mirror of `src/cli/sync.ts:syncEvents`

`src/quota/codex-chatgpt.ts` outline (real field paths confirmed by
reading openusage `internal/providers/codex/codex.go` + `live_usage.go`
before coding):

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

Response → snapshot mapping (per openusage `codex.go` `usagePayload`):

| Response path | `windowKey` | `utilization` | `resetsAt` | `unit` |
|---|---|---|---|---|
| `plan_type` | `plan` | — | — | `label` (label in rawJson) |
| `rate_limit.primary_window` | `rate_limit_primary` | used_percent / 100 | resets_at | `percent` |
| `rate_limit.secondary_window` | `rate_limit_secondary` | ditto | ditto | `percent` |
| `code_review_rate_limit.primary_window` | `code_review_rate_limit_primary` | ditto | ditto | `percent` |
| `code_review_rate_limit.secondary_window` | `code_review_rate_limit_secondary` | ditto | ditto | `percent` |
| `credits.balance` (if `has_credits`) | `credit_balance` | 0 if unlimited else — | — | `usd` |
| `additional_rate_limits[i]` | `additional_rate_limit_<i>` | ditto | ditto | `percent` |

`auth-file.ts` returns null silently when `~/.codex/auth.json` is
missing or unparseable — `isConfigured()` then returns false and the
registry skips this provider.

### Agent main-loop integration

`src/cli/agent.ts`:
- New scheduling parameter: `quotaRefreshSeconds: { active: 60, idle: 300 }`
- Track `lastQuotaRefreshAt`, `lastEventActivityAt` (refreshed when
  `runOnce` collects ≥1 new event)
- Active iff `Date.now() - lastEventActivityAt < 1h`
- Each tick compares `now - lastQuotaRefreshAt` against the active/idle
  threshold; if elapsed, call `runQuotaRefresh()`
- `runOnce()` calls `runQuotaRefresh()` at the end (single-flighted)
  so cron-mode users get coverage at sync cadence too

`src/cli/config.ts` `updateState` extends `state.json` shape:

```ts
lastQuotaRefreshAt?: string;
lastQuotaRefreshStatus?: "success" | "failed";
quotaAuthErrors?: Record<string, { code: number | string; lastFailedAt: string; consecutiveFailures: number }>;
```

`quotaAuthErrors` is written locally for forensics; **not surfaced in
the UI in v1**.

## Server API

### POST /api/usage/events/batch — extended (A)

Existing handler at `app/api/usage/events/batch/route.ts` is unchanged
because `ingestUsageEvents` does the mapping. The mapping in
`src/server/ingest.ts:136` adds 5 fields to the `rows.map`:

```ts
cacheEphemeral5mInputTokens: normalizeTokenCount(event.cacheEphemeral5mInputTokens),
cacheEphemeral1hInputTokens: normalizeTokenCount(event.cacheEphemeral1hInputTokens),
webSearchRequests: normalizeTokenCount(event.webSearchRequests),
webFetchRequests: normalizeTokenCount(event.webFetchRequests),
serviceTier: sanitizeNullableString(event.serviceTier ?? null),
```

`normalizeTokenCount(undefined) === 0`; `sanitizeNullableString(null) === null`. Old CLIs that don't send the fields land cleanly with defaults.

### POST /api/quota/snapshots/batch — new (B-Codex)

`app/api/quota/snapshots/batch/route.ts`. Auth: device-token bearer.

Body:

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

Validates `body.device.id === token.deviceId` if `device` is present.
Maps to `QuotaSnapshot.createMany` with `capturedBy = token.deviceId`.
No dedup — every call appends.

Response: `{ received, inserted }`.

### GET /api/quota/latest — new (B-Codex)

`app/api/quota/latest/route.ts`. Auth: user session.

Uses shared helper `src/server/quota.ts:getQuotaLatest(userId)`:

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

Groups into:

```ts
{
  byProvider: Record<string, {
    accountKey: string;
    capturedAt: string;  // most recent across all windows
    capturedBy: { id: string; name: string | null } | null;
    windows: Array<{ windowKey: string; utilization: number | null; usedRaw: number | null; limitRaw: number | null; unit: string | null; resetsAt: string | null }>;
  }>;
}
```

Wrapped in `unstable_cache` with 30s revalidate (consistent with
summaries). Cache key includes `userId` automatically. The route file
and `SubscriptionCard` server component both import `getQuotaLatest` —
single source.

## Browser UI

### Service-tier badge on /events (A)

New: `app/_components/tier-pill.tsx`

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

Rendered inline next to the model name in `/events` rows:

```tsx
<td>
  <span className="inline-flex items-center gap-1.5">
    {event.model ?? t("events.unknownModel")}
    <TierPill tier={event.serviceTier} />
  </span>
</td>
```

No new column — keeps the table's existing 11-column layout. Standard tier hidden = the 67k codex / 2k opencode events don't get a wasted column header.

Separate component (not extending `SourcePill`) because `SourcePill`
takes the source enum (claude-code/codex/...) and TierPill takes a
different dimension. Mixing would conflate two concerns.

### Subscription card on home (B-Codex)

New: `app/_components/subscription-card.tsx` — async server component.

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

`ConnectedCard` layout:

```
┌────────────────────────────────────────────────────────┐
│ ⚡ Codex / ChatGPT     ·    Plus tier        $4.85   │
│                                              余额    │
│   rate limit primary   ████▀▀▀▀▀▀▀▀▀ 35%   reset 2h │
│   rate limit secondary ██▀▀▀▀▀▀▀▀▀▀▀ 18%   reset 6h │
│   code review primary  █████████████ 92%   reset 1h │
│                                                       │
│ via device hanteen-mbp · refreshed 30s ago           │
└────────────────────────────────────────────────────────┘
```

Progress-bar color thresholds: < 70% brand-500, 70–89% amber-500, ≥ 90%
red-500. Quick visual signal for "running out".

`EmptyStateCard`:

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

Both render at the same size; first-page layout doesn't shift when a
user installs Codex.

`formatRelativeTime(value, t, tz)` and `formatUsd(value)` from
`@/shared/format` (timezone work already shipped this week is
leveraged).

### Home page layout (A's site is /events only; this is just for B-Codex)

`app/page.tsx` inserts `<SubscriptionCard userId={tenantId} />` wrapped
in `Suspense` between the existing hero row and the KPI row. Skeleton
fallback is a 16rem pulse rectangle.

### i18n keys (zh-CN + en, both files)

New top-level `subscription` namespace:

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

English mirror: "Subscription status" / "Codex / ChatGPT" / "{plan} tier"
/ "Credit balance" / "Rate limit (primary)" etc.

## Edge cases & error handling

**A pipeline:**
- Old CLI without new fields → `undefined` → `0` / `null` defaults
- Anthropic changes JSONL shape → `?.` chains tolerate; missing field
  stays at default; no throw
- `service_tier` is an unrecognized value (future "enterprise" tier) →
  `TierPill` renders fallback gray pill with the literal value
- Invariant violation (5m+1h > cacheWrite) → parser warns, stores
  values verbatim, does not throw

**B-Codex pipeline:**
- `~/.codex/auth.json` missing → `isConfigured()` false → skipped, no
  HTTP call, no DB write → empty state card
- `access_token` invalid (401 / 403) → provider returns error; no DB
  write; **previous QuotaSnapshot rows remain authoritative** so the
  card shows last-known good with stale `capturedAt`
- 10s network timeout via `AbortSignal.timeout()` → same as above
- Response shape changes → `?.` tolerates; recognized fields land,
  unknown fields are preserved in `rawJson` for forensics
- Missing `account_id` in response → fallback to `auth.json.accountId`
  → fallback to `"unknown"`. Never NULL (the DB column is NOT NULL)
- First-ever load (agent hasn't run a quota tick yet) → byProvider is
  empty → empty state card; first refresh fills it within 60s
- Multi-device polling → `DISTINCT ON (capturedAt DESC)` resolves to
  the most recent device's write; user sees `capturedBy` flap between
  devices, accepted v1

**Error logging:**
- Parser invariant warnings: collected via existing `warnings: string[]`
  return channel; agent logs to `~/.tokenizer/logs/agent.log`
- Provider fetch errors: same channel
- After 3 consecutive provider failures: `quotaAuthErrors[provider]`
  set in `state.json`. Read by future tooling (e.g., next round's
  reconnect banner); v1 does not surface in UI

## Testing

No React component test harness exists. Verification:

1. `npm run verify` — prisma generate + `tsc --noEmit` exits 0
2. `npm run test` — new vitest suites listed below

Vitest cases:

`tests/parsers/claude.test.ts` (extend):
- Synthetic JSONL line with all 5 new fields populated → assert correct
  extraction to `UsageEventInput`
- Synthetic JSONL line missing all 5 → assert `0 / 0 / 0 / 0 / null`
- Invariant-violating input → assert parser returns warnings, event
  still emitted

`tests/quota/auth-file.test.ts`:
- File exists with valid JSON → returns camelCase shape
- File missing → returns null (no throw)
- Malformed JSON → returns null (no throw)

`tests/quota/codex-chatgpt.test.ts`:
- Mocked 200 + fixture response (snapshot from openusage test fixture
  saved at `tests/fixtures/codex-chatgpt-response.json`) → asserts the
  expected snapshot rows by `windowKey`
- Mocked 401 → returns `{ snapshots: [], error: { code: 401 } }`
- Mocked timeout → returns error, does not throw
- Response with `credits.unlimited: true` → snapshot.utilization = 0 +
  rawJson.unlimited = true
- Response missing `account_id` → falls back to `auth.json.accountId`

`tests/quota/registry.test.ts`:
- One configured + one unconfigured → only configured runs
- One provider throws → other providers still run
- `accountKey` from result flows through to each snapshot

`tests/server/quota-batch.test.ts` (best-effort if existing batch
test pattern is followable):
- 5 valid snapshots → inserted = 5
- Mismatched device.id → 403
- Empty array → 200, inserted = 0

**Manual smoke (handed off to user):**

1. `npm run dev` → home page. Both you and hanteen are Codex users —
   subscription card should populate within 60s of agent running.
2. `mv ~/.codex/auth.json ~/.codex/auth.json.bak`; restart agent → next
   refresh: card flips to empty state.
3. Restore auth.json with intentionally corrupted access_token → 401
   → card retains last-known data, footer says "refreshed N minutes
   ago" (visibly stale).
4. Visit `/events` → priority-tier Claude events show orange pill next
   to the model name; codex / opencode events show no pill.

## Files touched

**New (10 files):**

A:
- `prisma/migrations/20260519100000_add_jsonl_enrichment_fields/migration.sql`

B-Codex:
- `prisma/migrations/20260519200000_add_quota_snapshot_table/migration.sql`
- `src/quota/types.ts`
- `src/quota/auth-file.ts`
- `src/quota/codex-chatgpt.ts`
- `src/quota/registry.ts`
- `src/quota/run.ts`
- `src/quota/sync.ts`
- `src/server/quota.ts` (server helper, shared by API route + RSC)
- `app/api/quota/snapshots/batch/route.ts`
- `app/api/quota/latest/route.ts`
- `app/_components/tier-pill.tsx`
- `app/_components/subscription-card.tsx`
- `tests/quota/auth-file.test.ts`
- `tests/quota/codex-chatgpt.test.ts`
- `tests/quota/registry.test.ts`
- `tests/fixtures/codex-chatgpt-response.json`

**Modified:**

A:
- `prisma/schema.prisma` (UsageEvent + 5 cols)
- `src/shared/usage.ts` (UsageEventInput +5 optional fields)
- `src/parsers/claude.ts` (extract +5 fields in `parseProjectJsonl`)
- `src/server/ingest.ts` (map +5 fields in `rows.map`)
- `app/events/page.tsx` (TierPill next to model name)
- `tests/parsers/claude.test.ts` (extend with 3 new cases)

B-Codex:
- `prisma/schema.prisma` (QuotaSnapshot + User/Device reverse relations)
- `src/cli/agent.ts` (quota tick scheduling)
- `src/cli/config.ts` (state.json fields)
- `app/page.tsx` (mount SubscriptionCard between hero and KPI rows)
- `messages/zh-CN.json` (subscription namespace, ~10 keys)
- `messages/en.json` (mirror)

**Unchanged but verified for impact:**
- `app/api/usage/events/batch/route.ts` — passes body through to
  `ingestUsageEvents`; the actual field mapping is in `ingest.ts`
- `src/auth.ts`, `src/server/auth-session.ts` — no auth changes
- `app/admin-shell.tsx` — no layout-shell changes (timezone reporter
  from prior round stays where it is)

## Open implementation notes

- **chatgpt.com endpoint path is TBD by the implementer.** PRD-B §13
  acknowledged this; openusage `internal/providers/codex/live_usage.go`
  (not yet read in this brainstorm) is the canonical reference. The
  implementer's first step is to fetch that file from
  `github.com/janekbaraniewski/openusage` and confirm the URL +
  response shape. If the shape has drifted from §codex.go documentation
  used in this spec, **update this spec inline** before coding.
- **JSONL grep before coding (A):** implementer greps a real
  `~/.claude/projects/**/*.jsonl` for `ephemeral_5m` and `service_tier`
  on `tripplezhou`'s machine to confirm presence. If absent in current
  Claude Code output, code still ships (forward-only) but document the
  observation in the PR.
- **No `unstable_cache` busting plan**: a quota refresh from the agent
  will not invalidate the 30s `/api/quota/latest` cache. Users may see
  up to 30s of staleness — acceptable.
