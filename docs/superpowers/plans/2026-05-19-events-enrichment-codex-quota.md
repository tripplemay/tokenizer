# Events Enrichment (A) + Codex Subscription Quota Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture 5 missing Claude JSONL fields into `UsageEvent` + render a service-tier pill on `/events`; capture ChatGPT/Codex subscription quota into a new `QuotaSnapshot` table on a 60s/300s agent tick + show it in a new home-page subscription card.

**Architecture:** Two largely-independent pipelines that share only the deploy migration. (A) extends `parsers/claude.ts` to read fields already present in JSONL, persists them through `ingest.ts`, and surfaces `service_tier` as a `<TierPill>` next to the model name. (B-Codex) adds a new `src/quota/` module that reads `~/.codex/auth.json`, polls `https://chatgpt.com/backend-api/wham/usage` from the agent, persists snapshots in append-only `QuotaSnapshot`, and renders them as a server-component subscription card on the home page using `getQuotaLatest` (DISTINCT ON, 30s `unstable_cache`).

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Prisma + PostgreSQL, undici, react-icons, next-intl, vitest (no React harness).

**Spec:** [docs/superpowers/specs/2026-05-19-events-enrichment-codex-quota-design.md](../specs/2026-05-19-events-enrichment-codex-quota-design.md) (中文版: `.zh-CN.md`)

**Verification model:**
- Per-task: `npm run verify` (prisma generate + `tsc --noEmit`) exits 0
- Test-bearing tasks also run `npm run test -- <specific path>`
- Final task: manual visual smoke handed off to the user (browser interaction + OS-level changes can't be subagent-driven)

**chatgpt.com endpoint (confirmed from openusage `internal/providers/codex/live_usage.go`):**
- `GET https://chatgpt.com/backend-api/wham/usage`
- Headers: `Authorization: Bearer <access_token>`, `Accept: application/json`, `User-Agent: tokenizer-cli/<version>`
- Optional header `ChatGPT-Account-Id: <id>` if `accountId` is known from `auth.json`
- Response JSON (snake_case wire format): `email`, `account_id`, `plan_type`, `rate_limit{primary_window, secondary_window}`, `code_review_rate_limit{primary_window, secondary_window}`, `additional_rate_limits[]`, `credits{has_credits, unlimited, balance}`, `rate_limit_status`

**Git identity for commits:** Use `git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit ...` on every commit. Do NOT run `git config`.

**Ordering rationale:** A-pipeline first (smaller, fewer files, lands user-visible TierPill quickly). B-Codex pipeline second (more files but largely self-contained). Schema migrations go before any code that reads/writes new columns.

---

## File Map

**A pipeline — new (1):**
- `prisma/migrations/20260519100000_add_jsonl_enrichment_fields/migration.sql`

**A pipeline — modified (6):**
- `prisma/schema.prisma` — UsageEvent +5 columns
- `src/shared/usage.ts` — UsageEventInput +5 optional fields
- `src/parsers/claude.ts` — extract +5 fields in JSONL parser
- `src/server/ingest.ts` — `rows.map` adds 5 fields
- `tests/parsers/claude.test.ts` — extend with 3 new cases
- `app/events/page.tsx` — TierPill next to model name

**A pipeline — new component (1):**
- `app/_components/tier-pill.tsx`

**B-Codex — new (10):**
- `prisma/migrations/20260519200000_add_quota_snapshot_table/migration.sql`
- `src/quota/types.ts`
- `src/quota/auth-file.ts`
- `src/quota/codex-chatgpt.ts`
- `src/quota/registry.ts`
- `src/quota/sync.ts`
- `src/quota/run.ts`
- `src/server/quota.ts` (shared by API + RSC)
- `app/api/quota/snapshots/batch/route.ts`
- `app/api/quota/latest/route.ts`
- `app/_components/subscription-card.tsx`
- `tests/fixtures/codex-chatgpt-response.json`
- `tests/quota/auth-file.test.ts`
- `tests/quota/codex-chatgpt.test.ts`
- `tests/quota/registry.test.ts`

**B-Codex — modified (5):**
- `prisma/schema.prisma` — QuotaSnapshot table + User/Device reverse relations
- `src/cli/agent.ts` — quota tick scheduling
- `src/cli/config.ts` — state.json fields
- `app/page.tsx` — mount SubscriptionCard
- `messages/zh-CN.json`, `messages/en.json` — `subscription` namespace

---

## Task 1: Schema migration A + UsageEvent fields

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260519100000_add_jsonl_enrichment_fields/migration.sql`

- [ ] **Step 1: Add columns to schema**

In `prisma/schema.prisma`, find `model UsageEvent { ... }`. After the existing `reasoningOutputTokens` line (or before the `@@unique` / `@@index` block at the bottom), add:

```prisma
  cacheEphemeral5mInputTokens Int     @default(0)
  cacheEphemeral1hInputTokens Int     @default(0)
  webSearchRequests           Int     @default(0)
  webFetchRequests            Int     @default(0)
  serviceTier                 String?
```

- [ ] **Step 2: Create the migration SQL file**

Write `prisma/migrations/20260519100000_add_jsonl_enrichment_fields/migration.sql`:

```sql
-- Capture Claude-Code JSONL fields that we currently drop on the floor.
-- All forward-only / safe defaults; existing rows and old clients unaffected.

ALTER TABLE "UsageEvent" ADD COLUMN "cacheEphemeral5mInputTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UsageEvent" ADD COLUMN "cacheEphemeral1hInputTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UsageEvent" ADD COLUMN "webSearchRequests" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UsageEvent" ADD COLUMN "webFetchRequests" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UsageEvent" ADD COLUMN "serviceTier" TEXT;
```

- [ ] **Step 3: Run verify (prisma client regen)**

Run: `npm run verify`
Expected: `prisma generate` regenerates client with the new fields; `tsc --noEmit` exits 0.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260519100000_add_jsonl_enrichment_fields/migration.sql
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(schema): add 5 Claude JSONL enrichment fields to UsageEvent

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Extend `UsageEventInput` + parse JSONL fields + parser tests

**Files:**
- Modify: `src/shared/usage.ts` (UsageEventInput)
- Modify: `src/parsers/claude.ts` (parseProjectJsonl or similar)
- Modify: `tests/parsers/claude.test.ts` (3 new cases)

- [ ] **Step 1: Extend `UsageEventInput`**

In `src/shared/usage.ts`, find `export type UsageEventInput = { ... }` (around line 3). Inside the type body, add:

```ts
  cacheEphemeral5mInputTokens?: number;
  cacheEphemeral1hInputTokens?: number;
  webSearchRequests?: number;
  webFetchRequests?: number;
  serviceTier?: string | null;
```

All optional so old CLIs continue to validate.

- [ ] **Step 2: Find the JSONL extraction site in `parsers/claude.ts`**

Read `/mnt/c/Users/tripplezhou/project/tokenizer/src/parsers/claude.ts`. The function that parses `~/.claude/projects/**/*.jsonl` assistant rows has an `events.push({ ... })` call. Locate the existing `cacheCreation` / `cacheRead` extraction near it.

- [ ] **Step 3: Add the 5-field extraction**

Immediately after the existing `cacheCreation` / `cacheRead` extraction, add:

```ts
const cacheCreationDetail = (usage.cache_creation ?? {}) as Record<string, unknown>;
const cacheEphemeral5m = normalizeTokenCount(cacheCreationDetail.ephemeral_5m_input_tokens);
const cacheEphemeral1h = normalizeTokenCount(cacheCreationDetail.ephemeral_1h_input_tokens);

const serverToolUse = (usage.server_tool_use ?? {}) as Record<string, unknown>;
const webSearchRequests = normalizeTokenCount(serverToolUse.web_search_requests);
const webFetchRequests = normalizeTokenCount(serverToolUse.web_fetch_requests);

const serviceTier = typeof usage.service_tier === "string" ? usage.service_tier : null;
```

`normalizeTokenCount` is imported from `@/shared/usage` (already in scope in this file — verify the import; if not present, add it). Then add these 5 fields to the existing `events.push({ ..., cacheEphemeral5mInputTokens: cacheEphemeral5m, cacheEphemeral1hInputTokens: cacheEphemeral1h, webSearchRequests, webFetchRequests, serviceTier })` call.

Do NOT touch the legacy session-meta path (`parseLegacySessionMeta` or equivalent) — that older format doesn't carry these fields.

- [ ] **Step 4: Write the failing parser tests**

Open `tests/parsers/claude.test.ts`. The file has an `assistantJsonlRow` helper around line 33 — extend it OR add a new helper that includes the new fields. Then add 3 new `it()` cases inside the existing `describe("parseClaudeUsage", () => { ... })`:

```ts
function assistantJsonlRowWithExtras(messageId: string, uuid: string, extras: {
  cacheEphemeral5m?: number;
  cacheEphemeral1h?: number;
  webSearch?: number;
  webFetch?: number;
  serviceTier?: string;
}) {
  return {
    type: "assistant",
    uuid,
    cwd: "/tmp/proj",
    timestamp: "2026-01-01T00:00:00.000Z",
    sessionId: "jsonl-session-extras",
    message: {
      role: "assistant",
      model: "claude-3-5-sonnet",
      id: messageId,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 100,
        cache_creation: {
          ephemeral_5m_input_tokens: extras.cacheEphemeral5m ?? 0,
          ephemeral_1h_input_tokens: extras.cacheEphemeral1h ?? 0,
        },
        server_tool_use: {
          web_search_requests: extras.webSearch ?? 0,
          web_fetch_requests: extras.webFetch ?? 0,
        },
        ...(extras.serviceTier ? { service_tier: extras.serviceTier } : {}),
      },
    },
  };
}

it("extracts ephemeral cache, web tool, and service_tier fields", () => {
  writeJsonl("proj-A", [
    assistantJsonlRowWithExtras("msg-100", "uuid-100", {
      cacheEphemeral5m: 100,
      cacheEphemeral1h: 50,
      webSearch: 2,
      webFetch: 1,
      serviceTier: "priority",
    }),
  ]);
  const result = parseClaudeUsage({ homeDir, projectRoots: [] });
  expect(result.events).toHaveLength(1);
  const event = result.events[0];
  expect(event.cacheEphemeral5mInputTokens).toBe(100);
  expect(event.cacheEphemeral1hInputTokens).toBe(50);
  expect(event.webSearchRequests).toBe(2);
  expect(event.webFetchRequests).toBe(1);
  expect(event.serviceTier).toBe("priority");
});

it("defaults all enrichment fields when JSONL omits them (backward compat)", () => {
  writeJsonl("proj-B", [assistantJsonlRow("msg-200", "uuid-200", { input: 10, output: 5 })]);
  const result = parseClaudeUsage({ homeDir, projectRoots: [] });
  expect(result.events).toHaveLength(1);
  const event = result.events[0];
  expect(event.cacheEphemeral5mInputTokens).toBe(0);
  expect(event.cacheEphemeral1hInputTokens).toBe(0);
  expect(event.webSearchRequests).toBe(0);
  expect(event.webFetchRequests).toBe(0);
  expect(event.serviceTier).toBeNull();
});

it("preserves a non-standard service_tier value verbatim", () => {
  writeJsonl("proj-C", [
    assistantJsonlRowWithExtras("msg-300", "uuid-300", { serviceTier: "enterprise-beta" }),
  ]);
  const result = parseClaudeUsage({ homeDir, projectRoots: [] });
  expect(result.events).toHaveLength(1);
  expect(result.events[0].serviceTier).toBe("enterprise-beta");
});
```

- [ ] **Step 5: Run tests — confirm pass**

Run: `npm run test -- tests/parsers/claude.test.ts`
Expected: existing tests still pass; 3 new tests pass.

- [ ] **Step 6: Run verify**

Run: `npm run verify`
Expected: zero TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/shared/usage.ts src/parsers/claude.ts tests/parsers/claude.test.ts
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(parsers): extract Claude JSONL enrichment fields

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Ingest server-side mapping for 5 new fields

**Files:**
- Modify: `src/server/ingest.ts` (rows.map)

- [ ] **Step 1: Read existing `ingest.ts:136`**

Read `/mnt/c/Users/tripplezhou/project/tokenizer/src/server/ingest.ts`. Locate the `const rows = events.map((event) => ({ ... }))` block. Find where existing fields like `reasoningOutputTokens`, `totalTokens`, `occurredAt` are mapped.

- [ ] **Step 2: Add 5 fields to the row mapping**

Before the `occurredAt` line (or near the existing `reasoningOutputTokens` field), add:

```ts
    cacheEphemeral5mInputTokens: normalizeTokenCount(event.cacheEphemeral5mInputTokens),
    cacheEphemeral1hInputTokens: normalizeTokenCount(event.cacheEphemeral1hInputTokens),
    webSearchRequests: normalizeTokenCount(event.webSearchRequests),
    webFetchRequests: normalizeTokenCount(event.webFetchRequests),
    serviceTier: sanitizeNullableString(event.serviceTier ?? null),
```

`normalizeTokenCount` and `sanitizeNullableString` are already imported / defined in this file (verify their imports near the top — `normalizeTokenCount` from `@/shared/usage`; `sanitizeNullableString` is a local helper).

`normalizeTokenCount(undefined) === 0` and `sanitizeNullableString(null) === null` — exactly matches the column defaults, so old CLIs that don't send these fields land cleanly.

- [ ] **Step 3: Run verify**

Run: `npm run verify`
Expected: zero TypeScript errors. (Prisma client already includes the 5 new fields from Task 1.)

- [ ] **Step 4: Commit**

```bash
git add src/server/ingest.ts
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(ingest): persist Claude JSONL enrichment fields to UsageEvent

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `TierPill` component + integration in `/events`

**Files:**
- Create: `app/_components/tier-pill.tsx`
- Modify: `app/events/page.tsx`

- [ ] **Step 1: Create the TierPill component**

Write `app/_components/tier-pill.tsx`:

```tsx
const colorByTier: Record<string, string> = {
  priority: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300",
  batch:    "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300",
};

// Renders a colored pill next to a model name when service_tier is non-default.
// "standard" returns null because it's the default tier — showing it on every
// row would be visual noise (67k of our 187k events are non-Claude and won't
// have a tier at all; we don't want a wasted column header for them either).
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

- [ ] **Step 2: Read existing `/events` page**

Read `/mnt/c/Users/tripplezhou/project/tokenizer/app/events/page.tsx`. Find the model column rendering — it's a `<td>` rendering `event.model ?? t("events.unknownModel")` or similar.

- [ ] **Step 3: Add the import + render TierPill inline**

Near the existing `import { SourcePill } from "../_components/source-pill"` line (or similar), add:

```tsx
import { TierPill } from "../_components/tier-pill";
```

Find the model `<td>` and replace its content. If it currently reads:

```tsx
<td className="py-2.5 pr-4 text-gray-600 dark:text-gray-300">{event.model ?? t("events.unknownModel")}</td>
```

Change to:

```tsx
<td className="py-2.5 pr-4 text-gray-600 dark:text-gray-300">
  <span className="inline-flex items-center gap-1.5">
    {event.model ?? t("events.unknownModel")}
    <TierPill tier={event.serviceTier} />
  </span>
</td>
```

Adjust the exact existing class strings to match what's there — only the inner content changes.

- [ ] **Step 4: Run verify**

Run: `npm run verify`
Expected: zero TypeScript errors. The `event.serviceTier` field comes from Prisma — it's `string | null` now that Task 1 + Task 3 have shipped.

- [ ] **Step 5: Commit**

```bash
git add app/_components/tier-pill.tsx app/events/page.tsx
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(events): show service-tier pill next to model name

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Schema migration B + `QuotaSnapshot` table

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260519200000_add_quota_snapshot_table/migration.sql`

- [ ] **Step 1: Add the `QuotaSnapshot` model**

In `prisma/schema.prisma`, after the existing `UsageEvent` model (or anywhere near the bottom but before the index/relation definitions for cross-references), add:

```prisma
model QuotaSnapshot {
  id           String    @id @default(cuid())
  userId       String
  provider     String
  accountKey   String
  windowKey    String
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

- [ ] **Step 2: Add reverse relations to User and Device**

In `prisma/schema.prisma`, find `model User { ... }`. Inside the relations section (where `accounts`, `sessions`, `projects`, `devices`, `usageEvents` live), add:

```prisma
  quotaSnapshots QuotaSnapshot[]
```

Find `model Device { ... }` and similarly add:

```prisma
  quotaSnapshots QuotaSnapshot[]
```

- [ ] **Step 3: Create the migration SQL**

Write `prisma/migrations/20260519200000_add_quota_snapshot_table/migration.sql`:

```sql
-- Append-only history of subscription quota snapshots fetched from
-- third-party APIs (chatgpt.com/backend-api, future Claude Web). "Latest"
-- is derived on read via DISTINCT ON (provider, windowKey).

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

- [ ] **Step 4: Run verify**

Run: `npm run verify`
Expected: `prisma generate` emits the `QuotaSnapshot` model on the client; `tsc --noEmit` exits 0.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260519200000_add_quota_snapshot_table/migration.sql
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(schema): add QuotaSnapshot table (append-only quota history)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `src/quota/types.ts` + `src/quota/auth-file.ts` + auth-file tests

**Files:**
- Create: `src/quota/types.ts`
- Create: `src/quota/auth-file.ts`
- Create: `tests/quota/auth-file.test.ts`

- [ ] **Step 1: Create the types module**

Write `src/quota/types.ts`:

```ts
export type QuotaSnapshotInput = {
  provider: string;
  accountKey: string;
  windowKey: string;
  utilization?: number;     // 0..1
  usedRaw?: number;         // server casts to BigInt
  limitRaw?: number;
  unit?: string;
  resetsAt?: string;        // ISO
  rawJson?: unknown;
};

export type QuotaProviderError = {
  code: number | string;
  message: string;
};

export type QuotaProviderResult = {
  snapshots: QuotaSnapshotInput[];
  accountKey: string | null;
  error?: QuotaProviderError;
};

export type QuotaProvider = {
  id: string;
  isConfigured(): Promise<boolean>;
  fetch(): Promise<QuotaProviderResult>;
};
```

- [ ] **Step 2: Write the failing auth-file test**

Write `tests/quota/auth-file.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fakeHome: string;
let restoreHome: () => void;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "tokenizer-auth-"));
  const originalHome = process.env.HOME;
  process.env.HOME = fakeHome;
  restoreHome = () => { process.env.HOME = originalHome; };
  vi.resetModules();
});

afterEach(() => {
  restoreHome();
  rmSync(fakeHome, { recursive: true, force: true });
});

function writeCodexAuth(content: string) {
  const dir = join(fakeHome, ".codex");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "auth.json"), content);
}

describe("readCodexAuthFile", () => {
  it("returns null when ~/.codex/auth.json does not exist", async () => {
    const { readCodexAuthFile } = await import("@/quota/auth-file");
    expect(readCodexAuthFile()).toBeNull();
  });

  it("returns null when the file contents are not valid JSON", async () => {
    writeCodexAuth("not-json");
    const { readCodexAuthFile } = await import("@/quota/auth-file");
    expect(readCodexAuthFile()).toBeNull();
  });

  it("maps snake_case fields from the file to camelCase", async () => {
    writeCodexAuth(JSON.stringify({
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: {
        access_token: "sk-token-xyz",
        account_id: "acct_123",
      },
      account_id: "acct_456",
    }));
    const { readCodexAuthFile } = await import("@/quota/auth-file");
    const auth = readCodexAuthFile();
    expect(auth).not.toBeNull();
    expect(auth?.authMode).toBe("chatgpt");
    expect(auth?.tokens?.accessToken).toBe("sk-token-xyz");
    expect(auth?.tokens?.accountId).toBe("acct_123");
    expect(auth?.accountId).toBe("acct_456");
  });

  it("returns null tokens.accessToken when the file lacks tokens entirely", async () => {
    writeCodexAuth(JSON.stringify({ auth_mode: "apikey" }));
    const { readCodexAuthFile } = await import("@/quota/auth-file");
    const auth = readCodexAuthFile();
    expect(auth?.tokens?.accessToken).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the test — expect it to fail**

Run: `npm run test -- tests/quota/auth-file.test.ts`
Expected: FAIL with "Cannot find module '@/quota/auth-file'".

- [ ] **Step 4: Implement auth-file.ts**

Write `src/quota/auth-file.ts`:

```ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type CodexAuth = {
  authMode?: string;
  tokens?: {
    accessToken?: string;
    accountId?: string;
  };
  accountId?: string;
};

// Read-only access to ~/.codex/auth.json. Codex CLI manages this file's
// lifecycle (login, refresh); we never write to it. Returns null on any
// error — missing file, invalid JSON, permission denied — so callers can
// treat "no Codex" uniformly.
//
// snake_case in the file is mapped to camelCase here so consumers don't
// have to deal with Go-style field names.
export function readCodexAuthFile(): CodexAuth | null {
  try {
    const path = join(homedir(), ".codex", "auth.json");
    const raw = readFileSync(path, "utf8");
    const json = JSON.parse(raw) as Record<string, unknown>;
    const tokens = json.tokens as Record<string, unknown> | undefined;
    return {
      authMode: typeof json.auth_mode === "string" ? json.auth_mode : undefined,
      tokens: tokens
        ? {
            accessToken: typeof tokens.access_token === "string" ? tokens.access_token : undefined,
            accountId: typeof tokens.account_id === "string" ? tokens.account_id : undefined,
          }
        : undefined,
      accountId: typeof json.account_id === "string" ? json.account_id : undefined,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run the test — expect it to pass**

Run: `npm run test -- tests/quota/auth-file.test.ts`
Expected: 4 tests pass.

- [ ] **Step 6: Run verify**

Run: `npm run verify`
Expected: zero TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/quota/types.ts src/quota/auth-file.ts tests/quota/auth-file.test.ts
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(quota): add types + Codex auth-file reader

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Codex provider + fixture + tests

**Files:**
- Create: `tests/fixtures/codex-chatgpt-response.json`
- Create: `src/quota/codex-chatgpt.ts`
- Create: `tests/quota/codex-chatgpt.test.ts`

- [ ] **Step 1: Create the fixture**

Write `tests/fixtures/codex-chatgpt-response.json` (anonymized sample of what `GET https://chatgpt.com/backend-api/wham/usage` returns; based on openusage's `internal/providers/codex/codex_test.go` fixtures):

```json
{
  "user_id": "user-abc",
  "account_id": "acct-fixture-001",
  "email": "fixture@example.com",
  "plan_type": "plus",
  "rate_limit": {
    "primary_window": {
      "used_percent": 35.5,
      "remaining_percent": 64.5,
      "window_minutes": 300,
      "resets_at": 1759910400
    },
    "secondary_window": {
      "used_percent": 18.0,
      "remaining_percent": 82.0,
      "window_minutes": 10080,
      "resets_at": 1760256000
    }
  },
  "code_review_rate_limit": {
    "primary_window": {
      "used_percent": 92.0,
      "remaining_percent": 8.0,
      "window_minutes": 60,
      "resets_at": 1759895000
    }
  },
  "additional_rate_limits": [],
  "credits": {
    "has_credits": true,
    "unlimited": false,
    "balance": 4.85
  }
}
```

- [ ] **Step 2: Write the failing provider test**

Write `tests/quota/codex-chatgpt.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

let fakeHome: string;
let restoreHome: () => void;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "tokenizer-codex-"));
  const originalHome = process.env.HOME;
  process.env.HOME = fakeHome;
  restoreHome = () => { process.env.HOME = originalHome; };
  vi.resetModules();
  vi.unstubAllGlobals();
});

afterEach(() => {
  restoreHome();
  rmSync(fakeHome, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

function writeCodexAuth(accessToken: string | null) {
  const dir = join(fakeHome, ".codex");
  mkdirSync(dir, { recursive: true });
  const body = accessToken ? { tokens: { access_token: accessToken } } : {};
  writeFileSync(join(dir, "auth.json"), JSON.stringify(body));
}

function mockFetch(response: { status: number; body?: unknown; throws?: Error }) {
  const fetchMock = vi.fn(async () => {
    if (response.throws) throw response.throws;
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      async json() { return response.body; },
      async text() { return JSON.stringify(response.body); },
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("codexChatgptProvider", () => {
  it("isConfigured returns false when no access token", async () => {
    writeCodexAuth(null);
    const { codexChatgptProvider } = await import("@/quota/codex-chatgpt");
    expect(await codexChatgptProvider.isConfigured()).toBe(false);
  });

  it("isConfigured returns true when access token is present", async () => {
    writeCodexAuth("sk-token");
    const { codexChatgptProvider } = await import("@/quota/codex-chatgpt");
    expect(await codexChatgptProvider.isConfigured()).toBe(true);
  });

  it("fetch maps fixture response into snapshot rows by windowKey", async () => {
    writeCodexAuth("sk-token");
    const fixture = JSON.parse(readFileSync(join(__dirname, "../fixtures/codex-chatgpt-response.json"), "utf8"));
    mockFetch({ status: 200, body: fixture });

    const { codexChatgptProvider } = await import("@/quota/codex-chatgpt");
    const result = await codexChatgptProvider.fetch();

    expect(result.error).toBeUndefined();
    expect(result.accountKey).toBe("acct-fixture-001");
    const keys = result.snapshots.map((s) => s.windowKey).sort();
    expect(keys).toContain("plan");
    expect(keys).toContain("rate_limit_primary");
    expect(keys).toContain("rate_limit_secondary");
    expect(keys).toContain("code_review_rate_limit_primary");
    expect(keys).toContain("credit_balance");

    const primary = result.snapshots.find((s) => s.windowKey === "rate_limit_primary");
    expect(primary?.utilization).toBeCloseTo(0.355);
    expect(primary?.unit).toBe("percent");
    expect(primary?.resetsAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const credit = result.snapshots.find((s) => s.windowKey === "credit_balance");
    expect(credit?.unit).toBe("usd");
    expect((credit?.rawJson as { balance?: number })?.balance).toBe(4.85);

    const plan = result.snapshots.find((s) => s.windowKey === "plan");
    expect(plan?.unit).toBe("label");
    expect((plan?.rawJson as { label?: string })?.label).toBe("plus");
  });

  it("returns error result on HTTP 401 without throwing", async () => {
    writeCodexAuth("sk-token");
    mockFetch({ status: 401, body: { error: "unauthorized" } });
    const { codexChatgptProvider } = await import("@/quota/codex-chatgpt");
    const result = await codexChatgptProvider.fetch();
    expect(result.error?.code).toBe(401);
    expect(result.snapshots).toEqual([]);
  });

  it("returns error result on network error", async () => {
    writeCodexAuth("sk-token");
    mockFetch({ status: 0, throws: new Error("ETIMEDOUT") });
    const { codexChatgptProvider } = await import("@/quota/codex-chatgpt");
    const result = await codexChatgptProvider.fetch();
    expect(result.error).toBeDefined();
    expect(result.snapshots).toEqual([]);
  });

  it("falls back to auth.json account_id when response has no account_id", async () => {
    writeCodexAuth("sk-token");
    const dir = join(fakeHome, ".codex");
    writeFileSync(join(dir, "auth.json"), JSON.stringify({
      tokens: { access_token: "sk-token" },
      account_id: "fallback-acct",
    }));
    mockFetch({ status: 200, body: { plan_type: "plus" } });
    const { codexChatgptProvider } = await import("@/quota/codex-chatgpt");
    const result = await codexChatgptProvider.fetch();
    expect(result.accountKey).toBe("fallback-acct");
  });

  it("marks credits.unlimited responses with utilization=0 and unlimited flag", async () => {
    writeCodexAuth("sk-token");
    mockFetch({ status: 200, body: { account_id: "acct-x", credits: { has_credits: true, unlimited: true, balance: 0 } } });
    const { codexChatgptProvider } = await import("@/quota/codex-chatgpt");
    const result = await codexChatgptProvider.fetch();
    const credit = result.snapshots.find((s) => s.windowKey === "credit_balance");
    expect(credit?.utilization).toBe(0);
    expect((credit?.rawJson as { unlimited?: boolean })?.unlimited).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test — expect it to fail**

Run: `npm run test -- tests/quota/codex-chatgpt.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 4: Implement the provider**

Write `src/quota/codex-chatgpt.ts`:

```ts
import { readCodexAuthFile } from "./auth-file";
import type { QuotaProvider, QuotaProviderResult, QuotaSnapshotInput } from "./types";

const CHATGPT_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const REQUEST_TIMEOUT_MS = 10_000;

type WindowInfo = {
  used_percent?: number;
  remaining_percent?: number;
  window_minutes?: number;
  resets_at?: number;
  reset_at?: number;
};

type RateLimit = {
  primary_window?: WindowInfo;
  secondary_window?: WindowInfo;
};

type ChatGptUsageResponse = {
  user_id?: string;
  account_id?: string;
  email?: string;
  plan_type?: string;
  rate_limit?: RateLimit;
  code_review_rate_limit?: RateLimit;
  additional_rate_limits?: Array<Record<string, unknown>>;
  credits?: { has_credits?: boolean; unlimited?: boolean; balance?: number };
};

export const codexChatgptProvider: QuotaProvider = {
  id: "codex-chatgpt",

  async isConfigured() {
    return readCodexAuthFile()?.tokens?.accessToken != null;
  },

  async fetch(): Promise<QuotaProviderResult> {
    const auth = readCodexAuthFile();
    const token = auth?.tokens?.accessToken;
    if (!token) {
      return {
        snapshots: [],
        accountKey: null,
        error: { code: "no_auth", message: "Codex auth.json missing or has no access_token" },
      };
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "user-agent": `tokenizer-cli/${process.env.TOKENIZER_VERSION ?? "dev"}`,
    };
    const accountIdForHeader = auth.tokens?.accountId ?? auth.accountId;
    if (accountIdForHeader) headers["chatgpt-account-id"] = accountIdForHeader;

    try {
      const response = await fetch(CHATGPT_USAGE_URL, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        return {
          snapshots: [],
          accountKey: auth.accountId ?? null,
          error: { code: response.status, message: await response.text() },
        };
      }
      const data = (await response.json()) as ChatGptUsageResponse;
      const accountKey = data.account_id ?? auth.tokens?.accountId ?? auth.accountId ?? "unknown";
      return {
        snapshots: mapResponseToSnapshots(data, accountKey),
        accountKey,
      };
    } catch (err) {
      return {
        snapshots: [],
        accountKey: auth.accountId ?? null,
        error: { code: "fetch_error", message: err instanceof Error ? err.message : String(err) },
      };
    }
  },
};

function mapResponseToSnapshots(data: ChatGptUsageResponse, accountKey: string): QuotaSnapshotInput[] {
  const rows: QuotaSnapshotInput[] = [];

  if (data.plan_type) {
    rows.push({
      provider: "codex-chatgpt",
      accountKey,
      windowKey: "plan",
      unit: "label",
      rawJson: { label: data.plan_type },
    });
  }

  if (data.rate_limit?.primary_window) {
    rows.push(snapshotFromWindow("rate_limit_primary", accountKey, data.rate_limit.primary_window));
  }
  if (data.rate_limit?.secondary_window) {
    rows.push(snapshotFromWindow("rate_limit_secondary", accountKey, data.rate_limit.secondary_window));
  }
  if (data.code_review_rate_limit?.primary_window) {
    rows.push(snapshotFromWindow("code_review_rate_limit_primary", accountKey, data.code_review_rate_limit.primary_window));
  }
  if (data.code_review_rate_limit?.secondary_window) {
    rows.push(snapshotFromWindow("code_review_rate_limit_secondary", accountKey, data.code_review_rate_limit.secondary_window));
  }
  if (data.additional_rate_limits && data.additional_rate_limits.length > 0) {
    data.additional_rate_limits.forEach((entry, idx) => {
      rows.push({
        provider: "codex-chatgpt",
        accountKey,
        windowKey: `additional_rate_limit_${idx}`,
        unit: "percent",
        rawJson: entry,
      });
    });
  }
  if (data.credits) {
    rows.push({
      provider: "codex-chatgpt",
      accountKey,
      windowKey: "credit_balance",
      utilization: data.credits.unlimited ? 0 : undefined,
      unit: "usd",
      rawJson: {
        balance: data.credits.balance,
        has_credits: data.credits.has_credits,
        unlimited: data.credits.unlimited,
      },
    });
  }

  return rows;
}

function snapshotFromWindow(windowKey: string, accountKey: string, w: WindowInfo): QuotaSnapshotInput {
  const resetSeconds = w.resets_at ?? w.reset_at;
  return {
    provider: "codex-chatgpt",
    accountKey,
    windowKey,
    utilization: w.used_percent != null ? w.used_percent / 100 : undefined,
    unit: "percent",
    resetsAt: resetSeconds != null ? new Date(resetSeconds * 1000).toISOString() : undefined,
    rawJson: w,
  };
}
```

- [ ] **Step 5: Run the test — expect it to pass**

Run: `npm run test -- tests/quota/codex-chatgpt.test.ts`
Expected: 6 tests pass.

- [ ] **Step 6: Run verify**

Run: `npm run verify`
Expected: zero TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/codex-chatgpt-response.json src/quota/codex-chatgpt.ts tests/quota/codex-chatgpt.test.ts
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(quota): add Codex/ChatGPT provider with response mapping

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Registry + tests

**Files:**
- Create: `src/quota/registry.ts`
- Create: `tests/quota/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Write `tests/quota/registry.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { QuotaProvider } from "@/quota/types";

function makeProvider(opts: {
  id: string;
  configured: boolean;
  result?: { snapshots?: unknown[]; accountKey?: string | null; error?: { code: number | string; message: string } };
  throws?: Error;
}): QuotaProvider {
  return {
    id: opts.id,
    isConfigured: vi.fn(async () => opts.configured),
    fetch: vi.fn(async () => {
      if (opts.throws) throw opts.throws;
      return {
        snapshots: (opts.result?.snapshots ?? []) as never,
        accountKey: opts.result?.accountKey ?? "acct-test",
        error: opts.result?.error,
      };
    }),
  };
}

describe("runConfiguredProviders", () => {
  it("skips providers whose isConfigured returns false", async () => {
    const a = makeProvider({ id: "a", configured: false });
    const b = makeProvider({ id: "b", configured: true, result: { snapshots: [{ provider: "b", accountKey: "", windowKey: "x" }] } });
    const { runConfiguredProviders } = await import("@/quota/registry");
    const result = await runConfiguredProviders([a, b]);
    expect(a.fetch).not.toHaveBeenCalled();
    expect(b.fetch).toHaveBeenCalled();
    expect(result.snapshots).toHaveLength(1);
  });

  it("collects errors per provider without aborting other providers", async () => {
    const failing = makeProvider({
      id: "failing",
      configured: true,
      result: { snapshots: [], error: { code: 401, message: "unauthorized" } },
    });
    const ok = makeProvider({
      id: "ok",
      configured: true,
      result: { snapshots: [{ provider: "ok", accountKey: "", windowKey: "x" }] },
    });
    const { runConfiguredProviders } = await import("@/quota/registry");
    const result = await runConfiguredProviders([failing, ok]);
    expect(result.errors.failing).toEqual({ code: 401, message: "unauthorized" });
    expect(result.snapshots).toHaveLength(1);
  });

  it("swallows provider exceptions and records them as errors", async () => {
    const throwing = makeProvider({ id: "throw", configured: true, throws: new Error("boom") });
    const ok = makeProvider({ id: "ok", configured: true, result: { snapshots: [{ provider: "ok", accountKey: "", windowKey: "x" }] } });
    const { runConfiguredProviders } = await import("@/quota/registry");
    const result = await runConfiguredProviders([throwing, ok]);
    expect(result.errors.throw).toBeDefined();
    expect(result.errors.throw.message).toContain("boom");
    expect(result.snapshots).toHaveLength(1);
  });

  it("backfills accountKey from provider result onto each snapshot", async () => {
    const provider = makeProvider({
      id: "p",
      configured: true,
      result: {
        snapshots: [
          { provider: "p", accountKey: "", windowKey: "a" },
          { provider: "p", accountKey: "should-be-overridden", windowKey: "b" },
        ],
        accountKey: "acct-real",
      },
    });
    const { runConfiguredProviders } = await import("@/quota/registry");
    const result = await runConfiguredProviders([provider]);
    expect(result.snapshots.every((s: { accountKey: string }) => s.accountKey === "acct-real")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test — expect it to fail**

Run: `npm run test -- tests/quota/registry.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the registry**

Write `src/quota/registry.ts`:

```ts
import { codexChatgptProvider } from "./codex-chatgpt";
import type { QuotaProvider, QuotaProviderError, QuotaSnapshotInput } from "./types";

// Default list. Tests pass an explicit array; production calls
// runConfiguredProviders() with no args and uses this.
const DEFAULT_PROVIDERS: QuotaProvider[] = [codexChatgptProvider];

export async function runConfiguredProviders(providers: QuotaProvider[] = DEFAULT_PROVIDERS): Promise<{
  snapshots: QuotaSnapshotInput[];
  errors: Record<string, QuotaProviderError>;
}> {
  const snapshots: QuotaSnapshotInput[] = [];
  const errors: Record<string, QuotaProviderError> = {};

  for (const provider of providers) {
    let configured: boolean;
    try {
      configured = await provider.isConfigured();
    } catch {
      configured = false;
    }
    if (!configured) continue;

    try {
      const result = await provider.fetch();
      if (result.error) {
        errors[provider.id] = result.error;
      }
      const accountKey = result.accountKey ?? "unknown";
      for (const snap of result.snapshots) {
        snapshots.push({ ...snap, accountKey });
      }
    } catch (err) {
      errors[provider.id] = {
        code: "fetch_threw",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return { snapshots, errors };
}
```

- [ ] **Step 4: Run the test — expect it to pass**

Run: `npm run test -- tests/quota/registry.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Run verify**

Run: `npm run verify`
Expected: zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/quota/registry.ts tests/quota/registry.test.ts
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(quota): add provider registry with error isolation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `sync.ts` (HTTP POST) + `run.ts` (orchestrator)

**Files:**
- Create: `src/quota/sync.ts`
- Create: `src/quota/run.ts`

- [ ] **Step 1: Read existing `src/cli/sync.ts` for the established POST pattern**

Read `/mnt/c/Users/tripplezhou/project/tokenizer/src/cli/sync.ts`. Note how `syncEvents` constructs `agentFetch(url, { method: "POST", headers: { authorization }, body, signal })`. The new quota POST follows the same convention.

- [ ] **Step 2: Implement `src/quota/sync.ts`**

```ts
import type { TokenizerConfig } from "@/cli/config";
import { readCredentials } from "@/cli/config";
import { agentFetch } from "@/cli/fetch";
import type { QuotaSnapshotInput } from "./types";

const REQUEST_TIMEOUT_MS = 30_000;

export async function syncQuotaSnapshots(
  config: TokenizerConfig,
  snapshots: QuotaSnapshotInput[]
): Promise<{ received: number; inserted: number }> {
  if (snapshots.length === 0) return { received: 0, inserted: 0 };
  const credentials = readCredentials();
  const url = `${config.serverUrl.replace(/\/+$/, "")}/api/quota/snapshots/batch`;
  const response = await agentFetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${credentials.deviceToken}`,
    },
    body: JSON.stringify({ snapshots }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Quota sync failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as { received: number; inserted: number };
}
```

- [ ] **Step 3: Implement `src/quota/run.ts`**

```ts
import type { TokenizerConfig } from "@/cli/config";
import { updateState } from "@/cli/config";
import { runConfiguredProviders } from "./registry";
import { syncQuotaSnapshots } from "./sync";

// Single-flight gate — agent's tick scheduler may fire while a previous
// refresh is still in flight (slow chatgpt.com, sleep/wake races). Same
// pattern as the existing sync single-flight in agent.ts.
let inflight: Promise<void> | null = null;

export function runQuotaRefresh(config: TokenizerConfig): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { snapshots, errors } = await runConfiguredProviders();
      const errorEntries = Object.entries(errors);
      const at = new Date().toISOString();

      if (snapshots.length > 0) {
        await syncQuotaSnapshots(config, snapshots);
      }

      const quotaAuthErrors: Record<string, { code: number | string; lastFailedAt: string; consecutiveFailures: number }> = {};
      for (const [providerId, err] of errorEntries) {
        // Naive: each call's error overwrites prior. The "consecutiveFailures"
        // counter is incremented in updateState; new error always lands at
        // lastFailedAt = now.
        quotaAuthErrors[providerId] = { code: err.code, lastFailedAt: at, consecutiveFailures: 1 };
      }

      updateState((state) => ({
        ...state,
        lastQuotaRefreshAt: at,
        lastQuotaRefreshStatus: errorEntries.length === 0 ? "success" : "failed",
        quotaAuthErrors: mergeQuotaAuthErrors(state.quotaAuthErrors, quotaAuthErrors, errorEntries.map(([id]) => id)),
      }));
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function mergeQuotaAuthErrors(
  prev: Record<string, { code: number | string; lastFailedAt: string; consecutiveFailures: number }> | undefined,
  current: Record<string, { code: number | string; lastFailedAt: string; consecutiveFailures: number }>,
  failedIds: string[]
) {
  const out = { ...(prev ?? {}) };
  for (const id of Object.keys(out)) {
    // Provider that failed before and is now succeeding gets cleared.
    if (!failedIds.includes(id)) delete out[id];
  }
  for (const [id, err] of Object.entries(current)) {
    const prior = prev?.[id];
    out[id] = {
      code: err.code,
      lastFailedAt: err.lastFailedAt,
      consecutiveFailures: (prior?.consecutiveFailures ?? 0) + 1,
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
```

- [ ] **Step 4: Run verify**

Run: `npm run verify`
Expected: zero TypeScript errors. (`updateState`'s exact signature might require a small adjustment to the merge logic — the implementer adapts based on `src/cli/config.ts:updateState`.)

If `updateState` signature differs, adapt by reading `src/cli/config.ts` and calling its actual API.

- [ ] **Step 5: Commit**

```bash
git add src/quota/sync.ts src/quota/run.ts
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(quota): add HTTP sync + run-once orchestrator with single-flight

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Agent main-loop integration (quota tick)

**Files:**
- Modify: `src/cli/agent.ts`
- Modify: `src/cli/config.ts` (state.json shape extension)

- [ ] **Step 1: Read existing `src/cli/agent.ts` runAgent / runOnce**

Read `/mnt/c/Users/tripplezhou/project/tokenizer/src/cli/agent.ts`. Find:
- The `runOnce` function (collects events, calls syncEvents)
- The `runAgent` function (long-running tick loop)
- The pattern for tracking `lastBeatAt` / `lastSyncAt`
- The tick scheduler (likely `setInterval` or `while(true) setTimeout`)

- [ ] **Step 2: Extend `state.json` shape in `src/cli/config.ts`**

Open `src/cli/config.ts`. Find the `TokenizerState` (or equivalent) type. Add:

```ts
  lastQuotaRefreshAt?: string;
  lastQuotaRefreshStatus?: "success" | "failed";
  lastEventActivityAt?: string;
  quotaAuthErrors?: Record<string, { code: number | string; lastFailedAt: string; consecutiveFailures: number }>;
```

- [ ] **Step 3: Modify `runOnce` to refresh `lastEventActivityAt` after a successful sync that collected ≥1 event, and call `runQuotaRefresh`**

In `src/cli/agent.ts`, near the existing import block, add:

```ts
import { runQuotaRefresh } from "@/quota/run";
```

Find the end of `runOnce` (after `syncEvents` succeeds). Add:

```ts
// Refresh "lastEventActivityAt" so the active-vs-idle tick scheduler knows
// this user is still coding. Threshold for active is 1 hour of zero events.
if (collectedEventCount > 0) {
  updateState((state) => ({ ...state, lastEventActivityAt: new Date().toISOString() }));
}

// Cron-mode safety net: also opportunistically refresh quota at the end of
// runOnce so users running `tokenizer run` on a cron get the same coverage
// as daemon-mode users. Single-flighted, non-fatal on error.
try {
  await runQuotaRefresh(config);
} catch (err) {
  log(`quota refresh failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
}
```

Adapt `collectedEventCount` to whatever variable name the code uses (perhaps `result.collected` or similar — look at the `syncEvents` return).

- [ ] **Step 4: Add quota tick to `runAgent`**

In the tick scheduler of `runAgent`, alongside the existing heartbeat / sync interval logic, add:

```ts
const QUOTA_ACTIVE_MS = 60_000;
const QUOTA_IDLE_MS = 300_000;
const ACTIVITY_WINDOW_MS = 60 * 60 * 1000;

// ... inside each tick ...
const now = Date.now();
const lastActivityAt = state.lastEventActivityAt ? new Date(state.lastEventActivityAt).getTime() : 0;
const isActive = lastActivityAt > 0 && (now - lastActivityAt) < ACTIVITY_WINDOW_MS;
const quotaThreshold = isActive ? QUOTA_ACTIVE_MS : QUOTA_IDLE_MS;
const lastQuotaAt = state.lastQuotaRefreshAt ? new Date(state.lastQuotaRefreshAt).getTime() : 0;
if (now - lastQuotaAt >= quotaThreshold) {
  // Fire-and-forget single-flighted; runQuotaRefresh's own guard prevents pile-up
  void runQuotaRefresh(config).catch((err) => {
    log(`quota refresh failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}
```

Adapt variable / function naming to whatever the existing scheduler uses.

- [ ] **Step 5: Run verify**

Run: `npm run verify`
Expected: zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/cli/agent.ts src/cli/config.ts
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(agent): schedule Codex quota refresh on 60s/300s tick

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Server-side helper + 2 quota API routes

**Files:**
- Create: `src/server/quota.ts`
- Create: `app/api/quota/snapshots/batch/route.ts`
- Create: `app/api/quota/latest/route.ts`

- [ ] **Step 1: Implement the shared helper**

Write `src/server/quota.ts`:

```ts
import { unstable_cache } from "next/cache";
import { prisma } from "./db";

const CACHE_REVALIDATE_SECONDS = 30;

export type QuotaLatestWindow = {
  windowKey: string;
  utilization: number | null;
  usedRaw: number | null;
  limitRaw: number | null;
  unit: string | null;
  resetsAt: string | null;
  rawJson: unknown;
};

export type QuotaLatestProvider = {
  accountKey: string;
  capturedAt: string;
  capturedBy: { id: string; name: string | null } | null;
  windows: QuotaLatestWindow[];
};

export type QuotaLatest = {
  byProvider: Record<string, QuotaLatestProvider>;
};

type LatestRow = {
  provider: string;
  windowKey: string;
  accountKey: string;
  utilization: string | null;
  usedRaw: bigint | null;
  limitRaw: bigint | null;
  unit: string | null;
  resetsAt: Date | null;
  capturedAt: Date;
  capturedBy: string | null;
  deviceName: string | null;
  rawJson: unknown;
};

async function getQuotaLatestImpl(userId: string): Promise<QuotaLatest> {
  const rows = await prisma.$queryRaw<LatestRow[]>`
    SELECT DISTINCT ON (q."provider", q."windowKey")
      q."provider", q."windowKey", q."accountKey",
      q."utilization", q."usedRaw", q."limitRaw", q."unit",
      q."resetsAt", q."capturedAt", q."capturedBy", q."rawJson",
      d."name" AS "deviceName"
    FROM "QuotaSnapshot" q
    LEFT JOIN "Device" d ON d."id" = q."capturedBy"
    WHERE q."userId" = ${userId}
    ORDER BY q."provider", q."windowKey", q."capturedAt" DESC
  `;

  const byProvider: Record<string, QuotaLatestProvider> = {};
  for (const r of rows) {
    const provider = byProvider[r.provider] ?? {
      accountKey: r.accountKey,
      capturedAt: r.capturedAt.toISOString(),
      capturedBy: r.capturedBy ? { id: r.capturedBy, name: r.deviceName } : null,
      windows: [],
    };
    provider.windows.push({
      windowKey: r.windowKey,
      utilization: r.utilization != null ? Number(r.utilization) : null,
      usedRaw: r.usedRaw != null ? Number(r.usedRaw) : null,
      limitRaw: r.limitRaw != null ? Number(r.limitRaw) : null,
      unit: r.unit,
      resetsAt: r.resetsAt ? r.resetsAt.toISOString() : null,
      rawJson: r.rawJson,
    });
    const capturedAtIso = r.capturedAt.toISOString();
    if (capturedAtIso > provider.capturedAt) {
      provider.capturedAt = capturedAtIso;
      provider.capturedBy = r.capturedBy ? { id: r.capturedBy, name: r.deviceName } : null;
    }
    byProvider[r.provider] = provider;
  }
  return { byProvider };
}

export const getQuotaLatest = unstable_cache(
  getQuotaLatestImpl,
  ["getQuotaLatest"],
  { revalidate: CACHE_REVALIDATE_SECONDS }
);
```

- [ ] **Step 2: Implement POST /api/quota/snapshots/batch**

Write `app/api/quota/snapshots/batch/route.ts`:

```ts
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { authenticateDeviceToken, forbidden, unauthorized } from "@/server/auth";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

type SnapshotBody = {
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
};

export async function POST(request: NextRequest) {
  const token = await authenticateDeviceToken(request);
  if (!token) return unauthorized();

  const body = (await request.json()) as SnapshotBody;
  if (!Array.isArray(body?.snapshots)) {
    return Response.json({ error: "snapshots required" }, { status: 400 });
  }
  if (body.device && body.device.id !== token.deviceId) {
    return forbidden("device token does not match device");
  }
  if (body.snapshots.length === 0) {
    return Response.json({ received: 0, inserted: 0 });
  }

  const rows = body.snapshots.map((s) => ({
    userId: token.userId,
    provider: s.provider,
    accountKey: s.accountKey,
    windowKey: s.windowKey,
    utilization: s.utilization != null ? new Prisma.Decimal(s.utilization) : null,
    usedRaw: s.usedRaw != null ? BigInt(Math.round(s.usedRaw)) : null,
    limitRaw: s.limitRaw != null ? BigInt(Math.round(s.limitRaw)) : null,
    unit: s.unit ?? null,
    resetsAt: s.resetsAt ? new Date(s.resetsAt) : null,
    capturedBy: token.deviceId,
    rawJson: s.rawJson === undefined ? Prisma.JsonNull : (s.rawJson as Prisma.InputJsonValue),
  }));

  const result = await prisma.quotaSnapshot.createMany({ data: rows });
  return Response.json({ received: body.snapshots.length, inserted: result.count });
}
```

- [ ] **Step 3: Implement GET /api/quota/latest**

Write `app/api/quota/latest/route.ts`:

```ts
import { NextRequest } from "next/server";
import { requireSession } from "@/server/auth-session";
import { getQuotaLatest } from "@/server/quota";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  const session = await requireSession();
  const data = await getQuotaLatest(session.user.id);
  return Response.json(data);
}
```

- [ ] **Step 4: Run verify**

Run: `npm run verify`
Expected: zero TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/quota.ts app/api/quota/snapshots/batch/route.ts app/api/quota/latest/route.ts
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(api): add quota snapshot batch + latest endpoints

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: i18n keys for subscription card

**Files:**
- Modify: `messages/zh-CN.json`
- Modify: `messages/en.json`

- [ ] **Step 1: Add the `subscription` namespace to zh-CN.json**

In `messages/zh-CN.json`, find a sensible insertion point (e.g., right after the `login` namespace or right before `admin`). Add:

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
  },
```

Mind the trailing comma — there must be a key after `subscription` for the JSON to parse.

- [ ] **Step 2: Add the matching English mirror to en.json**

```json
  "subscription": {
    "title": "Subscription status",
    "codex": {
      "title": "Codex / ChatGPT",
      "planLabel": "{plan} tier",
      "creditBalance": "Credit balance",
      "ratePrimary": "Rate limit (primary)",
      "rateSecondary": "Rate limit (secondary)",
      "codeReviewPrimary": "Code review (primary)",
      "codeReviewSecondary": "Code review (secondary)",
      "resetsIn": "resets in {time}"
    },
    "empty": {
      "title": "Codex CLI not detected",
      "hint": "Install it and your ChatGPT subscription status will show up here",
      "installLink": "Installation docs"
    },
    "footer": {
      "viaDevice": "via {device}·refreshed {ago} ago",
      "refreshed": "refreshed {ago} ago"
    }
  },
```

- [ ] **Step 3: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('messages/zh-CN.json','utf8'))" && node -e "JSON.parse(require('fs').readFileSync('messages/en.json','utf8'))" && echo OK`
Expected: prints `OK`.

- [ ] **Step 4: Run verify**

Run: `npm run verify`
Expected: zero TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add messages/zh-CN.json messages/en.json
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(i18n): add subscription namespace

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: `SubscriptionCard` component

**Files:**
- Create: `app/_components/subscription-card.tsx`

- [ ] **Step 1: Implement the server component**

Write `app/_components/subscription-card.tsx`:

```tsx
import { MdBolt } from "react-icons/md";
import { getTranslations } from "next-intl/server";
import Card from "@/components/card";
import { getQuotaLatest, type QuotaLatestProvider, type QuotaLatestWindow } from "@/server/quota";
import { getUserTimezone } from "@/server/timezone";
import { formatRelativeTime, formatUsd } from "@/shared/format";

export async function SubscriptionCard({ userId }: { userId: string }) {
  const t = await getTranslations();
  const tz = await getUserTimezone(userId);
  const latest = await getQuotaLatest(userId);
  const codex = latest.byProvider["codex-chatgpt"];

  if (!codex) {
    return <EmptyStateCard t={t} />;
  }
  return <ConnectedCard codex={codex} t={t} tz={tz} />;
}

type Translator = (key: string, values?: Record<string, string | number>) => string;

function EmptyStateCard({ t }: { t: Translator }) {
  return (
    <Card extra="p-6">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-500/10 text-brand-500">
          <MdBolt className="h-5 w-5" />
        </span>
        <h3 className="text-lg font-bold text-navy-700 dark:text-white">{t("subscription.title")}</h3>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400">{t("subscription.empty.title")}</p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t("subscription.empty.hint")}</p>
      <a
        href="https://github.com/openai/codex"
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-500 hover:underline"
      >
        {t("subscription.empty.installLink")} →
      </a>
    </Card>
  );
}

function ConnectedCard({ codex, t, tz }: { codex: QuotaLatestProvider; t: Translator; tz: string }) {
  const planRow = codex.windows.find((w) => w.windowKey === "plan");
  const primaryRow = codex.windows.find((w) => w.windowKey === "rate_limit_primary");
  const secondaryRow = codex.windows.find((w) => w.windowKey === "rate_limit_secondary");
  const codeReviewPrimary = codex.windows.find((w) => w.windowKey === "code_review_rate_limit_primary");
  const codeReviewSecondary = codex.windows.find((w) => w.windowKey === "code_review_rate_limit_secondary");
  const creditRow = codex.windows.find((w) => w.windowKey === "credit_balance");
  const planLabel = (planRow?.rawJson as { label?: string } | null)?.label ?? "—";
  const creditRaw = creditRow?.rawJson as { balance?: number; unlimited?: boolean } | null;

  return (
    <Card extra="p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-500/10 text-brand-500">
            <MdBolt className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-lg font-bold text-navy-700 dark:text-white">{t("subscription.codex.title")}</h3>
            {planRow && (
              <p className="text-xs text-gray-500">{t("subscription.codex.planLabel", { plan: planLabel })}</p>
            )}
          </div>
        </div>
        {creditRaw && (
          <div className="text-right">
            <div className="text-xs text-gray-500">{t("subscription.codex.creditBalance")}</div>
            <div className="text-lg font-bold text-navy-700 dark:text-white">
              {creditRaw.unlimited ? "∞" : creditRaw.balance != null ? formatUsd(creditRaw.balance) : "—"}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {primaryRow && <RateLimitRow label={t("subscription.codex.ratePrimary")} window={primaryRow} t={t} tz={tz} />}
        {secondaryRow && <RateLimitRow label={t("subscription.codex.rateSecondary")} window={secondaryRow} t={t} tz={tz} />}
        {codeReviewPrimary && <RateLimitRow label={t("subscription.codex.codeReviewPrimary")} window={codeReviewPrimary} t={t} tz={tz} />}
        {codeReviewSecondary && <RateLimitRow label={t("subscription.codex.codeReviewSecondary")} window={codeReviewSecondary} t={t} tz={tz} />}
      </div>

      <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
        {codex.capturedBy?.name
          ? t("subscription.footer.viaDevice", { device: codex.capturedBy.name, ago: formatRelativeTime(codex.capturedAt, t, tz) })
          : t("subscription.footer.refreshed", { ago: formatRelativeTime(codex.capturedAt, t, tz) })}
      </p>
    </Card>
  );
}

function RateLimitRow({ label, window: w, t, tz }: { label: string; window: QuotaLatestWindow; t: Translator; tz: string }) {
  const pct = w.utilization != null ? Math.round(w.utilization * 100) : null;
  const barColor =
    pct == null ? "bg-gray-200 dark:bg-white/10" :
    pct >= 90 ? "bg-red-500" :
    pct >= 70 ? "bg-amber-500" :
    "bg-brand-500";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
        <span>{label}</span>
        <span>
          {pct != null ? `${pct}%` : "—"}
          {w.resetsAt && (
            <span className="ml-2 text-gray-500">
              {t("subscription.codex.resetsIn", { time: formatRelativeTime(w.resetsAt, t, tz) })}
            </span>
          )}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/5">
        <div className={`h-full ${barColor}`} style={{ width: pct != null ? `${pct}%` : "0%" }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run verify**

Run: `npm run verify`
Expected: zero TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add app/_components/subscription-card.tsx
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(home): add SubscriptionCard server component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Mount SubscriptionCard on home page

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add the import**

In `app/page.tsx`, find the existing imports from `./_components/...`. Add:

```tsx
import { SubscriptionCard } from "./_components/subscription-card";
```

- [ ] **Step 2: Mount between hero and KPI rows**

Find the existing `<Suspense fallback={<HeroRowSkeleton />}><HeroSection ... /></Suspense>` block. Immediately after its closing tag, and before the `{/* KPI ROW */}` block, insert:

```tsx
{/* SUBSCRIPTION ROW */}
<Suspense fallback={<SubscriptionCardSkeleton />}>
  <SubscriptionCard userId={tenantId} />
</Suspense>
```

- [ ] **Step 3: Add the skeleton**

Find the existing `function HeroRowSkeleton()` declaration. Immediately above or below it, add:

```tsx
function SubscriptionCardSkeleton() {
  return (
    <Card extra="p-6">
      <div className="mb-4 h-5 w-40 rounded bg-gray-100 dark:bg-white/10" />
      <div className="h-32 animate-pulse rounded-xl bg-gray-100 dark:bg-white/5" />
    </Card>
  );
}
```

- [ ] **Step 4: Run verify**

Run: `npm run verify`
Expected: zero TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(home): mount SubscriptionCard between hero and KPI rows

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Manual visual smoke test

**Files:** none modified (handed off to user)

Subagents cannot do this — requires browser interaction + OS timezone changes + agent restarts.

- [ ] **Step 1: Apply migrations**

Run: `npx prisma migrate dev` locally, or wait for the deploy pipeline to apply the two new migrations.

- [ ] **Step 2: Start dev server + agent**

Run `npm run dev` in one terminal.
Run `tokenizer agent` in another (assuming you've already enrolled).

- [ ] **Step 3: Verify the home page subscription card**

Open `http://localhost:3000/` while signed in. Within 60 seconds of the agent's first tick, the **Subscription Status** card should appear between the hero row and the KPI row. It should show:

- Plan label (e.g. "plus tier")
- Credit balance (e.g. "$X.XX" or "∞" for unlimited)
- One or more rate-limit rows with horizontal progress bars + "resets in Xh Ym"
- Footer line "via device <hostname>·refreshed Xs ago"

- [ ] **Step 4: Verify the empty state**

Stop the agent. `mv ~/.codex/auth.json ~/.codex/auth.json.bak`. Restart the agent. Wait 60s. Refresh the dashboard. The card should now show "Codex CLI not detected" with the installation docs link.

Restore: `mv ~/.codex/auth.json.bak ~/.codex/auth.json`.

- [ ] **Step 5: Verify the stale-data resilience**

Stop the agent. Open `~/.codex/auth.json` and corrupt the access token by changing one character. Restart the agent. Watch `~/.tokenizer/logs/agent.log` for the 401 error. The card should retain its previous data — `refreshed N minutes ago` shows visibly stale.

Restore the real token (or run `codex login` again).

- [ ] **Step 6: Verify the service-tier badge on /events**

Navigate to `http://localhost:3000/events`. For any Claude Code event with `service_tier: "priority"`, the row should show an **orange pill** next to the model name. Codex / Opencode rows (no service_tier) should not show a pill.

If your real data has no priority-tier events (likely — most Claude usage is standard), use `psql` to manually set a test row:

```sql
UPDATE "UsageEvent"
SET "serviceTier" = 'priority'
WHERE id = (SELECT id FROM "UsageEvent" WHERE source = 'claude-code' ORDER BY "occurredAt" DESC LIMIT 1);
```

Refresh `/events`. The most recent Claude row should now have an orange `priority` pill.

- [ ] **Step 7: Verify the dark-mode rendering**

Toggle dark mode via the navbar. Both the subscription card and the tier pill should render correctly with their dark variants (no white-on-white or invisible text).

- [ ] **Step 8: Final commit (only if smoke surfaced an issue)**

If smoke passed cleanly: nothing to commit.

If a visible regression required a tweak:

```bash
git add <touched-files>
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "fix(quota): <describe the tweak>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Summary of Commits

After Task 14 completes, the branch should contain these commits:

1. `feat(schema): add 5 Claude JSONL enrichment fields to UsageEvent`
2. `feat(parsers): extract Claude JSONL enrichment fields`
3. `feat(ingest): persist Claude JSONL enrichment fields to UsageEvent`
4. `feat(events): show service-tier pill next to model name`
5. `feat(schema): add QuotaSnapshot table (append-only quota history)`
6. `feat(quota): add types + Codex auth-file reader`
7. `feat(quota): add Codex/ChatGPT provider with response mapping`
8. `feat(quota): add provider registry with error isolation`
9. `feat(quota): add HTTP sync + run-once orchestrator with single-flight`
10. `feat(agent): schedule Codex quota refresh on 60s/300s tick`
11. `feat(api): add quota snapshot batch + latest endpoints`
12. `feat(i18n): add subscription namespace`
13. `feat(home): add SubscriptionCard server component`
14. `feat(home): mount SubscriptionCard between hero and KPI rows`
15. (Optional from Task 15) `fix(quota): <tweak from smoke testing>`
