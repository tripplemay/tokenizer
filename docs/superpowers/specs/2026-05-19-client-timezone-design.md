# Client Timezone Capture + Per-User Timezone Application

**Date:** 2026-05-19
**Status:** Approved (pending spec review)

## Problem

The dashboard hardcodes `Asia/Shanghai` in two places:

1. `src/server/summaries.ts:605` — used by 5 daily-bucketing SQL queries
   (`getDailySummary`, `getDailyByDevice`, `getDailyBySource`, `getDailyCost`,
   `getDailyForDevice`) via `date_trunc('day', "occurredAt" AT TIME ZONE
   'Asia/Shanghai')::date`.
2. `src/shared/format.ts:1` — used by `formatDateTime`,
   `formatDateTimeSeconds`, `formatRelativeTime` via
   `Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", ... })`.

Multi-tenant support shipped on 2026-05-04 (commit `959aa62`) without
addressing the hardcoded timezone, despite a `TODO`-style comment at
`summaries.ts:602-604` acknowledging the need:

> // Hardcoded for now because the PRD scopes Tokenizer to a single
> // user; revisit when multi-tenant support is on the table.

The client (`src/cli/sync.ts`, `src/cli/enroll.ts`, `src/parsers/*`)
never captures or reports any timezone. Server has no way to know where
any user actually is. Result: a user outside UTC+8 sees daily buckets
shifted by 8±h and times rendered in Shanghai wall-clock — confusing
and incorrect for that user even though stored data is fine.

## Goals

- Capture each user's effective timezone (IANA name, e.g.
  `America/Los_Angeles`) automatically from two sources:
  - CLI agent on every sync + heartbeat
  - Browser on dashboard mount
- Store as `User.timezone String?` (single field, last-writer-wins).
- Apply per-user timezone to all 5 daily-bucketing SQL queries and to
  all date/time formatters in the dashboard.
- Fall back to `Asia/Shanghai` when `User.timezone` is null (preserves
  current behavior for existing users until first sync/visit).

## Non-Goals

- Per-device timezone (`Device.timezone`). Multi-device users in
  different zones will see User.timezone flap between the most-recent
  reporters' values — accepted v1 trade-off.
- Manual timezone override via a settings page. No /settings route
  exists today; building one is out of scope.
- Backfilling existing events. `occurredAt` is stored as UTC; the new
  per-user `AT TIME ZONE` clause re-buckets them on demand. No data
  migration needed.
- Auth.js JWT/session injection of timezone. The JWT has a rotation
  window; querying `User.timezone` fresh per page render is simpler and
  more responsive to recent updates.
- Timezone offset display ("+8" / "-7"). DST transitions make this
  misleading; the IANA name is the source of truth.
- Daily email / scheduled reports. Feature does not exist today.

## Architecture

```
[CLI agent / browser]
       │
       │ Intl.DateTimeFormat().resolvedOptions().timeZone
       │   - sync.ts POST body adds top-level `timezone`
       │   - heartbeat.ts POST body adds top-level `timezone`
       │   - browser TimezoneReporter PATCHes /api/me/timezone on mount
       │
       ▼
[POST /api/usage/events/batch]     [POST /api/devices/heartbeat]    [PATCH /api/me/timezone]
       │                                  │                                │
       │  updateUserTimezoneIfValid(userId, body.timezone)  ← shared helper
       │                                  │                                │
       ▼                                  ▼                                ▼
[Postgres: User.timezone TEXT NULL]
       │
       │ getUserTimezone(userId) — React cache() dedup per render
       │ const tz = user.timezone ?? "Asia/Shanghai"
       │
       ▼
[Server components pass `tz` explicitly to:]
       │   getDailySummary(tenantId, range, tz)
       │   getDailyByDevice(tenantId, range, tz)
       │   getDailyBySource(tenantId, range, tz)
       │   getDailyCost(tenantId, range, tz)
       │   getDailyForDevice(tenantId, deviceId, range, tz)
       │   formatDateTime(value, tz)
       │   formatDateTimeSeconds(value, tz)
       │   formatRelativeTime(value, t, tz)
       │
       ▼
[Dashboard renders bucketed + formatted to user's tz]
```

## Schema Changes

`prisma/schema.prisma`:

```prisma
model User {
  id              String              @id @default(cuid())
  email           String              @unique
  emailVerified   DateTime?
  name            String?
  image           String?
  role            String              @default("user")
  quotaTier       String              @default("free")
  timezone        String?             // ← NEW: IANA name, e.g. "Asia/Shanghai"
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
  // existing relations unchanged
}
```

Migration: `ALTER TABLE "User" ADD COLUMN "timezone" TEXT;` (nullable,
no default, zero-impact on the 141k existing events and 6 existing
users).

Why nullable rather than `DEFAULT 'Asia/Shanghai'`: NULL distinguishes
"never reported" from "deliberately chose Asia/Shanghai" — the latter
becomes meaningful when a manual override is eventually added. Code
falls back via `user.timezone ?? "Asia/Shanghai"`; the DB does not
lie.

Why no DB-level CHECK constraint: IANA names number 400+, an `IN(...)`
list is impractical; validation lives at the application layer
(`Intl.DateTimeFormat({timeZone})` constructor).

## Client Capture (CLI + Browser)

### 3.1 CLI sync / heartbeat

`src/shared/usage.ts` — extend `BatchUsageRequest`:

```ts
export type BatchUsageRequest = {
  device?: DeviceInput;
  events: UsageEventInput[];
  timezone?: string;  // IANA name, e.g. "Asia/Shanghai"
};
```

`src/cli/sync.ts` — both sync and heartbeat bodies add the same field:

```ts
body: JSON.stringify({
  device: deviceWithDiagnostics(),
  events,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
})
```

The heartbeat body type at `app/api/devices/heartbeat/route.ts:13`
widens to `{ device?: DeviceInput; timezone?: string }`.

Rationale for top-level placement (not nested under `device`):
- Conceptually a user-level signal even when measured from a device
- Heartbeat doesn't carry events, but does carry the device — top-level
  keeps the timezone slot present and consistent
- Server can validate + write to `User.timezone` without nested digging

Reliability of `Intl.DateTimeFormat().resolvedOptions().timeZone` in
Node: Node 14+ ships full-ICU on most platforms and returns the system
IANA tz name. Minimal-ICU builds (rare) fall back to "UTC", which is
still a valid IANA name. The expression never throws.

### 3.2 Browser

New: `app/_components/timezone-reporter.tsx` (client component, ~25
lines):

```tsx
"use client";
import { useEffect } from "react";

export function TimezoneReporter() {
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return;
    fetch("/api/me/timezone", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timezone: tz }),
      credentials: "same-origin",
    }).catch(() => {});
  }, []);
  return null;
}
```

Fire-and-forget; failures are not surfaced. Mounted inside
`app/admin-shell.tsx` (which already short-circuits on `/login` routes)
so the request only fires once the user is authenticated.

New: `app/api/me/timezone/route.ts` (server route, ~25 lines) — PATCH
handler. Validates, then writes via shared helper. Returns 400 on
invalid input so any future caller knows the error.

## Server-Side Helpers

New: `src/server/timezone.ts` (consolidates all timezone server logic):

```ts
import { cache } from "react";
import { prisma } from "./db";

const DEFAULT_TIMEZONE = "Asia/Shanghai";
const MAX_TZ_LENGTH = 64;

export function isValidIanaTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > MAX_TZ_LENGTH) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(userTz: string | null | undefined): string {
  return userTz && userTz.length > 0 ? userTz : DEFAULT_TIMEZONE;
}

// React 19 cache() — dedups within a single render so multiple
// aggregation calls in one page don't each re-query User.timezone.
// NOT wrapped in unstable_cache: we want a fresh read on every page
// request so a recent tz update is reflected immediately.
export const getUserTimezone = cache(async (userId: string): Promise<string> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  return resolveTimezone(user?.timezone);
});

// Best-effort update — silently ignores invalid tz. Sync and heartbeat
// endpoints call this; we never want a bad tz string to fail the whole
// ingest. The /api/me/timezone PATCH endpoint validates BEFORE this
// and returns 400 to the browser when invalid.
export async function updateUserTimezoneIfValid(userId: string, tz: unknown): Promise<void> {
  if (!isValidIanaTimezone(tz)) return;
  await prisma.user.update({
    where: { id: userId },
    data: { timezone: tz },
  });
}
```

## Aggregation SQL Changes

`src/server/summaries.ts`:

1. Delete line 605: `const REPORTING_TIMEZONE = "Asia/Shanghai";`
2. 5 impl functions add a `timezone` parameter, default `"Asia/Shanghai"`
   for safe fallback if a caller is missed during the migration:

```ts
async function getDailySummaryImpl(
  tenantId: string,
  range: RangeOption = "all",
  timezone: string = "Asia/Shanghai",
) { /* ... */ }
```

3. Each SQL query replaces `${REPORTING_TIMEZONE}` with `${timezone}`:

```sql
date_trunc('day', "occurredAt" AT TIME ZONE ${timezone})::date AS date,
```

4. The `unstable_cache` wrappers stay as-is. `unstable_cache`
   automatically incorporates function arguments into the cache key,
   so different `tz` values get separate cache entries naturally.

Affected functions (and their line numbers in current source):
- `getDailySummaryImpl` (line 632)
- `getDailyByDeviceImpl` (line 426)
- `getDailyBySourceImpl` (line 716)
- `getDailyCostImpl` (line 672)
- `getDailyForDevice` (line 388)

## Page Callers

Each server page that calls a daily-bucketed function adds one line and
threads `tz` through:

```ts
import { getUserTimezone } from "@/server/timezone";

const session = await requireSession();
const tenantId = session.user.id;
const tz = await getUserTimezone(tenantId);  // ← NEW

// downstream:
const daily = await getDailySummary(tenantId, range, tz);
const dailyCost = await getDailyCost(tenantId, range, tz);
// ...
```

Pages affected (5):
- `app/page.tsx` (home)
- `app/devices/page.tsx`
- `app/events/page.tsx` (only uses `formatDateTimeSeconds` — needs tz)
- `app/projects/[id]/page.tsx`
- `app/devices/[id]/page.tsx`

`getUserTimezone` is wrapped in React 19 `cache()` so multiple calls
within one render dedup to a single DB query.

## Display Formatter Changes

`src/shared/format.ts`:

1. Remove the module-level `REPORTING_TIMEZONE` constant and the
   pre-instantiated `dateTimeFmt` / `dateTimeSecondsFmt`.
2. Add per-timezone memoized formatters (avoids re-constructing
   `Intl.DateTimeFormat` on every call):

```ts
const DEFAULT_TIMEZONE = "Asia/Shanghai";
const dateTimeCache = new Map<string, Intl.DateTimeFormat>();
const dateTimeSecondsCache = new Map<string, Intl.DateTimeFormat>();

function getDateTimeFmt(timezone: string): Intl.DateTimeFormat {
  let fmt = dateTimeCache.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("sv-SE", {
      timeZone: timezone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
    dateTimeCache.set(timezone, fmt);
  }
  return fmt;
}
// (analogous getDateTimeSecondsFmt)
```

3. Three functions get a trailing `timezone` parameter (default
   `Asia/Shanghai` for safe fallback):

```ts
export function formatDateTime(
  value: Date | string | null | undefined,
  timezone: string = DEFAULT_TIMEZONE,
): string { /* ... */ }

export function formatDateTimeSeconds(
  value: Date | string | null | undefined,
  timezone: string = DEFAULT_TIMEZONE,
): string { /* ... */ }

export function formatRelativeTime(
  value: Date | string | null | undefined,
  t: (key: string, values?: Record<string, string | number>) => string,
  timezone: string = DEFAULT_TIMEZONE,
): string { /* ... */ }
```

All ~12 call sites across server components add the trailing `tz`
argument. Pure renderers (`formatTokens`, `formatUsd`, `formatPercent`,
etc.) are unaffected.

## i18n Changes

`messages/zh-CN.json`:

```json
"timezone": {
  "note": "所有时间均按 {tz} 时区显示。"
}
```

`messages/en.json`:

```json
"timezone": {
  "note": "All times shown in {tz}."
}
```

Callers thread tz through:

```tsx
<p>{t("timezone.note", { tz })}</p>
```

The hardcoded "UTC+8" suffix is removed because the offset varies by
user location and DST.

## Edge Cases

- **Invalid IANA injected into SQL**: `updateUserTimezoneIfValid`
  validates via `Intl.DateTimeFormat` constructor before writing. Even
  if bypassed, Postgres `AT TIME ZONE` raises `invalid_parameter_value`
  on parameter binding — no injection risk.
- **Multi-device cross-tz flapping**: User.timezone reflects most
  recent reporter (CLI sync or browser). v1 accepts this; v2 may
  introduce `Device.timezone`. Behavior is documented in the
  timezone.note disclosure.
- **Existing 141k events / 6 users**: occurredAt is UTC; SQL `AT TIME
  ZONE ${tz}` re-buckets at read time. No backfill needed. Until each
  user's first sync/visit, they fall back to `Asia/Shanghai` (matches
  current behavior).
- **Browser PATCH without session**: `requireSession()` throws → 401;
  TimezoneReporter is fire-and-forget; no user impact.
- **Cache invalidation when tz changes**: `unstable_cache` uses tz as
  part of the cache key, so a tz change for a user automatically reads
  the new bucket. 30s TTL window between change and visible effect.
- **Same tz reported repeatedly**: `User.update` writes the same value;
  no special "did it change?" check. Cost is trivial. Avoided premature
  optimization.

## Testing

No React component test harness exists. Verification:

1. **`npm run verify`** — prisma generate + `tsc --noEmit` exits 0.
2. **Unit tests** (vitest, fits existing `tests/**/*.test.ts` pattern):
   - `tests/server/timezone.test.ts`:
     - `isValidIanaTimezone`: valid names ("Asia/Shanghai",
       "America/Los_Angeles", "UTC"), invalid names (empty, null,
       "Foo/Bar", 65-char overflow, SQL meta), object/number rejection
     - `resolveTimezone`: null/undefined/empty → "Asia/Shanghai";
       valid → passthrough
   - These tests are the security boundary for SQL safety; high-value.
3. **Manual browser smoke** (handed off to user):
   - Visit dashboard as tripplezhou — confirm User.timezone gets
     populated (query DB or check `timezone.note` text).
   - Daily charts continue to bucket at UTC+8 (no visible regression
     for Shanghai user).
   - On VPS: `docker compose exec postgres psql -c "SELECT email,
     timezone FROM \"User\" ORDER BY \"createdAt\" DESC;"` — confirm
     real timezones populate over time as CLI agents sync.
   - Temporary manual test: change OS tz to America/Los_Angeles, run
     the agent for one sync cycle, refresh dashboard — buckets shift
     accordingly.

## Files Touched

**New:**
- `src/server/timezone.ts` (~50 lines)
- `app/_components/timezone-reporter.tsx` (~20 lines)
- `app/api/me/timezone/route.ts` (~25 lines)
- `tests/server/timezone.test.ts`
- `prisma/migrations/<timestamp>_add_user_timezone/migration.sql`

**Modified:**
- `prisma/schema.prisma` (add `timezone String?` to User)
- `src/shared/usage.ts` (add `timezone?: string` to BatchUsageRequest)
- `src/cli/sync.ts` (sync + heartbeat bodies add `timezone`)
- `src/server/summaries.ts` (delete REPORTING_TIMEZONE; 5 impl
  signatures add `timezone` param; 5 SQL queries use `${timezone}`)
- `src/shared/format.ts` (replace pre-instantiated formatters with
  per-tz memoized factory; 3 functions add `timezone` param)
- `app/admin-shell.tsx` (mount `<TimezoneReporter />`)
- `app/api/usage/events/batch/route.ts` (call
  `updateUserTimezoneIfValid` after auth)
- `app/api/devices/heartbeat/route.ts` (call
  `updateUserTimezoneIfValid` after the transaction)
- `app/page.tsx`, `app/devices/page.tsx`, `app/events/page.tsx`,
  `app/projects/[id]/page.tsx`, `app/devices/[id]/page.tsx` (each adds
  `const tz = await getUserTimezone(tenantId)` and threads tz through
  formatter + summary calls)
- `messages/zh-CN.json`, `messages/en.json` (`timezone.note` becomes
  parameterized)

**Unchanged but verified for impact:**
- `src/auth.ts`, `src/server/auth.ts`, `src/server/auth-session.ts` —
  Auth.js / session unchanged
- `src/server/ingest.ts` — event ingestion logic unchanged
- All parsers (`src/parsers/*.ts`) — already produce UTC ISO strings
