# Client Timezone Capture + Per-User Timezone Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture each user's effective IANA timezone (from CLI sync/heartbeat and browser dashboard mount), store it on `User.timezone`, and thread it through the 5 daily-bucketing SQL queries and 3 date/time formatters so users outside Asia/Shanghai see correctly-bucketed and correctly-formatted dashboard data.

**Architecture:** New nullable `User.timezone` column. New `src/server/timezone.ts` consolidates IANA validation, fallback-to-Asia/Shanghai resolution, and a React 19 `cache()`-wrapped `getUserTimezone(userId)` helper. CLI agent and browser report timezone (last-writer-wins); ingest endpoints + a new browser PATCH route call a shared `updateUserTimezoneIfValid` helper. Every server page resolves the user's tz once per render and threads it through aggregation + formatter calls. Default fallback `"Asia/Shanghai"` preserves current behavior for users who haven't reported yet.

**Tech Stack:** Next.js 15 App Router (server components + server actions), React 19 (`cache()`), TypeScript, Prisma + PostgreSQL (`AT TIME ZONE` clause), `Intl.DateTimeFormat` for both validation and display, `next-intl` for the `timezone.note` localized string.

**Spec:** [docs/superpowers/specs/2026-05-19-client-timezone-design.md](../specs/2026-05-19-client-timezone-design.md)

**Verification model:**
- Per-task: `npm run verify` (prisma generate + `tsc --noEmit`) exits 0
- Task 2 also runs unit tests via `npm run test` (the timezone helper is the security boundary for SQL safety — high-value to unit-test)
- Final task: manual visual smoke handed off to user (browser interaction can't be subagent-driven)

**Ordering rationale:**
1. Schema + migration first — every later task depends on the column existing
2. Server helper + unit tests second — the validation/resolution primitives are used everywhere downstream
3. Capture pipeline (CLI + ingest API + browser endpoint + reporter component) before consumption — so by the time consumption code reads `User.timezone`, the column is being populated
4. Aggregation SQL + formatter refactor before page-caller threading — pages call into these, so they need to accept the new `timezone` parameter first
5. Page callers + i18n last — they consume everything

**Git identity for commits:** Use `git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit ...` on every commit. Do NOT run `git config`.

---

## File Map

**New files:**
- `prisma/migrations/20260519000000_add_user_timezone/migration.sql` — adds the nullable column
- `src/server/timezone.ts` (~50 lines) — `isValidIanaTimezone`, `resolveTimezone`, `getUserTimezone` (React cache), `updateUserTimezoneIfValid`
- `tests/server/timezone.test.ts` — vitest unit tests for the helper
- `app/_components/timezone-reporter.tsx` (~20 lines) — client component that PATCHes tz on mount
- `app/api/me/timezone/route.ts` (~25 lines) — PATCH handler

**Modified files:**
- `prisma/schema.prisma` — add `timezone String?` to `User`
- `src/shared/usage.ts` — extend `BatchUsageRequest` with optional `timezone`
- `src/cli/sync.ts` — both `sync()` and `heartbeat()` bodies attach `timezone`
- `app/api/usage/events/batch/route.ts` — call `updateUserTimezoneIfValid` after auth
- `app/api/devices/heartbeat/route.ts` — widen body type; call `updateUserTimezoneIfValid` after the transaction
- `app/admin-shell.tsx` — mount `<TimezoneReporter />` inside the authenticated-shell branch
- `src/server/summaries.ts` — delete `REPORTING_TIMEZONE`; add `timezone` param to 5 impl functions; replace 5 SQL `AT TIME ZONE` clauses
- `src/shared/format.ts` — replace module-level formatters with per-tz memoized factory; 3 functions accept `timezone` parameter
- `app/page.tsx`, `app/devices/page.tsx`, `app/events/page.tsx`, `app/projects/[id]/page.tsx`, `app/devices/[id]/page.tsx` — each adds `const tz = await getUserTimezone(tenantId)` and threads `tz` through formatter + summary calls
- `messages/zh-CN.json`, `messages/en.json` — parameterize `timezone.note` with `{tz}`

**Unchanged but verified for impact:**
- `src/server/ingest.ts` — event ingest body unchanged (timezone is plumbed via the API route, not through ingest)
- `src/auth.ts`, `src/server/auth-session.ts` — no session-shape changes
- `src/parsers/*.ts` — already produce UTC ISO strings; nothing to change

---

## Task 1: Add `User.timezone` schema column + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260519000000_add_user_timezone/migration.sql`

- [ ] **Step 1: Add the column to schema**

In `prisma/schema.prisma`, locate the `model User { ... }` block (starts at line 14). After the `quotaTier` line and before the `createdAt` line, add:

```prisma
  timezone        String?
```

Confirm the User block now looks like (excerpt):

```prisma
model User {
  id              String              @id @default(cuid())
  email           String              @unique
  emailVerified   DateTime?
  name            String?
  image           String?
  role            String              @default("user")
  quotaTier       String              @default("free")
  timezone        String?
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
  // ...existing relations unchanged
}
```

- [ ] **Step 2: Create the migration SQL by hand**

Write `prisma/migrations/20260519000000_add_user_timezone/migration.sql` with this exact content:

```sql
-- Add a nullable timezone column to User. IANA name (e.g. "Asia/Shanghai").
-- Populated lazily by CLI sync/heartbeat or browser dashboard mount.
-- Application falls back to "Asia/Shanghai" when null, preserving prior
-- behavior for users who haven't reported yet.

ALTER TABLE "User" ADD COLUMN "timezone" TEXT;
```

(We write the migration file by hand rather than running `prisma migrate dev` because a subagent has no local Postgres. `prisma migrate deploy` in CI will pick this up by directory timestamp.)

- [ ] **Step 3: Regenerate Prisma client + typecheck**

Run: `npm run verify`
Expected: `prisma generate` succeeds (the new `timezone` field appears in the generated client types); `tsc --noEmit` exits 0.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260519000000_add_user_timezone/migration.sql
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(schema): add User.timezone column

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Server timezone helper + unit tests

**Files:**
- Create: `src/server/timezone.ts`
- Create: `tests/server/timezone.test.ts`

- [ ] **Step 1: Write the unit test FIRST (TDD)**

Write `tests/server/timezone.test.ts` with this exact content:

```ts
import { describe, expect, it } from "vitest";
import { isValidIanaTimezone, resolveTimezone } from "@/server/timezone";

describe("isValidIanaTimezone", () => {
  it("accepts well-known IANA names", () => {
    expect(isValidIanaTimezone("Asia/Shanghai")).toBe(true);
    expect(isValidIanaTimezone("America/Los_Angeles")).toBe(true);
    expect(isValidIanaTimezone("Europe/London")).toBe(true);
    expect(isValidIanaTimezone("UTC")).toBe(true);
  });

  it("rejects empty / nullish / non-string", () => {
    expect(isValidIanaTimezone("")).toBe(false);
    expect(isValidIanaTimezone(null)).toBe(false);
    expect(isValidIanaTimezone(undefined)).toBe(false);
    expect(isValidIanaTimezone(123)).toBe(false);
    expect(isValidIanaTimezone({})).toBe(false);
  });

  it("rejects overlong strings (potential injection vector)", () => {
    expect(isValidIanaTimezone("a".repeat(65))).toBe(false);
    expect(isValidIanaTimezone("a".repeat(64))).toBe(false);  // exactly the limit still rejected because not a real tz
  });

  it("rejects invalid IANA names", () => {
    expect(isValidIanaTimezone("Foo/Bar")).toBe(false);
    expect(isValidIanaTimezone("Not_A_Real_Zone")).toBe(false);
    expect(isValidIanaTimezone("'; DROP TABLE \"User\"; --")).toBe(false);
  });
});

describe("resolveTimezone", () => {
  it("returns Asia/Shanghai fallback for null/undefined/empty", () => {
    expect(resolveTimezone(null)).toBe("Asia/Shanghai");
    expect(resolveTimezone(undefined)).toBe("Asia/Shanghai");
    expect(resolveTimezone("")).toBe("Asia/Shanghai");
  });

  it("passes through any non-empty value (validation is a separate concern)", () => {
    expect(resolveTimezone("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(resolveTimezone("UTC")).toBe("UTC");
  });
});
```

- [ ] **Step 2: Run the test — expect it to fail with module-not-found**

Run: `npm run test -- tests/server/timezone.test.ts`
Expected: FAIL with an error about `@/server/timezone` not being resolvable.

- [ ] **Step 3: Create the helper module**

Write `src/server/timezone.ts` with this exact content:

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
// request so a recent tz update (from CLI sync or browser PATCH) is
// reflected immediately.
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

- [ ] **Step 4: Run the test — expect it to pass**

Run: `npm run test -- tests/server/timezone.test.ts`
Expected: PASS (4 test cases under `isValidIanaTimezone`, 2 under `resolveTimezone`).

- [ ] **Step 5: Run full verify**

Run: `npm run verify`
Expected: zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/server/timezone.ts tests/server/timezone.test.ts
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(server): add timezone helper module + unit tests

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Extend `BatchUsageRequest` type with optional `timezone`

**Files:**
- Modify: `src/shared/usage.ts`

- [ ] **Step 1: Add the field**

In `src/shared/usage.ts`, find the `BatchUsageRequest` type (around line 45). It currently reads:

```ts
export type BatchUsageRequest = {
  device?: DeviceInput;
  events: UsageEventInput[];
};
```

Replace with:

```ts
export type BatchUsageRequest = {
  device?: DeviceInput;
  events: UsageEventInput[];
  timezone?: string;
};
```

- [ ] **Step 2: Run typecheck**

Run: `npm run verify`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/usage.ts
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(shared): add optional timezone field to BatchUsageRequest

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: CLI sync/heartbeat attach `timezone`

**Files:**
- Modify: `src/cli/sync.ts`

- [ ] **Step 1: Read current file structure**

Read `/mnt/c/Users/tripplezhou/project/tokenizer/src/cli/sync.ts` and locate:
- The body of `sync()` where `JSON.stringify({ device, events })` is constructed
- The body of `heartbeat()` (around line 96-108) where `JSON.stringify({ device: deviceWithDiagnostics() })` is constructed

- [ ] **Step 2: Add timezone to the `sync()` POST body**

Find the line inside the `sync()` function where the body is built. It looks similar to:

```ts
body: JSON.stringify({
  device: deviceWithDiagnostics(),
  events,
})
```

Replace with:

```ts
body: JSON.stringify({
  device: deviceWithDiagnostics(),
  events,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
})
```

- [ ] **Step 3: Add timezone to the `heartbeat()` POST body**

Around line 104 of `src/cli/sync.ts`, find:

```ts
body: JSON.stringify({ device: deviceWithDiagnostics() }),
```

Replace with:

```ts
body: JSON.stringify({
  device: deviceWithDiagnostics(),
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
}),
```

- [ ] **Step 4: Run typecheck**

Run: `npm run verify`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/cli/sync.ts
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(cli): attach IANA timezone to sync + heartbeat payloads

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Sync/heartbeat API routes write `User.timezone`

**Files:**
- Modify: `app/api/usage/events/batch/route.ts`
- Modify: `app/api/devices/heartbeat/route.ts`

- [ ] **Step 1: Update the sync ingest route**

Modify `app/api/usage/events/batch/route.ts`. Add an import line near the existing imports:

```ts
import { updateUserTimezoneIfValid } from "@/server/timezone";
```

Then inside the `POST` handler, after the device-token-match check (`if (body.device.id !== token.deviceId) return forbidden(...)`) and BEFORE the `await ingestUsageEvents(...)` call, add:

```ts
await updateUserTimezoneIfValid(token.userId, body.timezone);
```

The final handler should look like:

```ts
export async function POST(request: NextRequest) {
  const token = await authenticateDeviceToken(request);
  if (!token) return unauthorized();

  const body = (await request.json()) as BatchUsageRequest;
  if (!body?.device?.id || !body.device.name || !Array.isArray(body.events)) {
    return Response.json({ error: "device and events are required" }, { status: 400 });
  }
  if (body.device.id !== token.deviceId) return forbidden("device token does not match device");

  await updateUserTimezoneIfValid(token.userId, body.timezone);

  const result = await ingestUsageEvents(body.events, body.device, token.id, token.userId);
  return Response.json(result);
}
```

- [ ] **Step 2: Update the heartbeat route**

Modify `app/api/devices/heartbeat/route.ts`. Add the import:

```ts
import { updateUserTimezoneIfValid } from "@/server/timezone";
```

Widen the body type (line 13). It currently reads:

```ts
const body = (await request.json().catch(() => null)) as { device?: DeviceInput } | null;
```

Replace with:

```ts
const body = (await request.json().catch(() => null)) as { device?: DeviceInput; timezone?: string } | null;
```

Then AFTER the `prisma.$transaction([...])` call (around line 40) and BEFORE the `return Response.json(...)`, add:

```ts
await updateUserTimezoneIfValid(token.userId, body.timezone);
```

The transaction block + tz update + response should look like:

```ts
  await prisma.$transaction([
    prisma.device.update({ where: { id: body.device.id }, data }),
    prisma.deviceToken.update({ where: { id: token.id }, data: { lastUsedAt: now } })
  ]);

  await updateUserTimezoneIfValid(token.userId, body.timezone);

  return Response.json({ ok: true, deviceId: body.device.id, lastSeenAt: now.toISOString() });
```

- [ ] **Step 3: Run typecheck**

Run: `npm run verify`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/usage/events/batch/route.ts app/api/devices/heartbeat/route.ts
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(api): persist User.timezone from sync + heartbeat payloads

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Browser PATCH endpoint `/api/me/timezone`

**Files:**
- Create: `app/api/me/timezone/route.ts`

- [ ] **Step 1: Create the route file**

Write `app/api/me/timezone/route.ts` with this exact content:

```ts
import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth-session";
import { isValidIanaTimezone, updateUserTimezoneIfValid } from "@/server/timezone";

export const dynamic = "force-dynamic";

// Browser TimezoneReporter PATCHes this on dashboard mount. Returns 400
// on invalid input so a future caller can detect the error; CLI ingest
// endpoints take a softer approach (silently drop bad values) because
// failing the whole sync over a tz string would be disproportionate.
export async function PATCH(request: Request) {
  const session = await requireSession();
  const body = await request.json().catch(() => null);
  if (!isValidIanaTimezone(body?.timezone)) {
    return NextResponse.json({ error: "invalid_timezone" }, { status: 400 });
  }
  await updateUserTimezoneIfValid(session.user.id, body.timezone);
  return NextResponse.json({ ok: true, timezone: body.timezone });
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run verify`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/me/timezone/route.ts
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(api): add PATCH /api/me/timezone endpoint

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Browser `TimezoneReporter` component + mount in AdminShell

**Files:**
- Create: `app/_components/timezone-reporter.tsx`
- Modify: `app/admin-shell.tsx`

- [ ] **Step 1: Create the client component**

Write `app/_components/timezone-reporter.tsx` with this exact content:

```tsx
"use client";

import { useEffect } from "react";

// Reports the browser's IANA timezone to the server once per mount.
// Fire-and-forget: failures aren't surfaced because losing this update
// isn't worth bothering the user — the next dashboard load (or CLI
// sync) will try again. Returns null because it has no visual output.
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

- [ ] **Step 2: Mount in AdminShell**

Modify `app/admin-shell.tsx`. Add an import:

```tsx
import { TimezoneReporter } from "./_components/timezone-reporter";
```

The current return value of `AdminShell` (after the `pathname?.startsWith("/login")` early return) looks like:

```tsx
  return (
    <div className="flex h-full w-full bg-background-100 dark:bg-background-900">
      <Sidebar routes={routes} open={open} setOpen={setOpen} variant="admin" />
      <div className="h-full w-full font-dm dark:bg-navy-900">
        <main className="mx-2.5 flex-none transition-all dark:bg-navy-900 md:pr-2 xl:ml-[323px]">
          <div>
            <Navbar
              onOpenSidenav={() => setOpen(!open)}
              brandText={getActiveRoute(routes, pathname || "/")}
              secondary={false}
            />
            <div className="mx-auto min-h-screen p-2 !pt-[10px] md:p-2">
              {children}
            </div>
            <div className="p-3">
              <Footer />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
```

Replace with (just adds `<TimezoneReporter />` at the bottom of the inner content; placement is irrelevant since it renders null):

```tsx
  return (
    <div className="flex h-full w-full bg-background-100 dark:bg-background-900">
      <Sidebar routes={routes} open={open} setOpen={setOpen} variant="admin" />
      <div className="h-full w-full font-dm dark:bg-navy-900">
        <main className="mx-2.5 flex-none transition-all dark:bg-navy-900 md:pr-2 xl:ml-[323px]">
          <div>
            <Navbar
              onOpenSidenav={() => setOpen(!open)}
              brandText={getActiveRoute(routes, pathname || "/")}
              secondary={false}
            />
            <div className="mx-auto min-h-screen p-2 !pt-[10px] md:p-2">
              {children}
            </div>
            <div className="p-3">
              <Footer />
            </div>
          </div>
        </main>
      </div>
      <TimezoneReporter />
    </div>
  );
```

The `TimezoneReporter` is inside the post-login-bypass branch, so it only mounts for authenticated dashboard pages — exactly what we want.

- [ ] **Step 3: Run typecheck**

Run: `npm run verify`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add app/_components/timezone-reporter.tsx app/admin-shell.tsx
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(login): mount TimezoneReporter on authenticated dashboard

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Aggregation SQL — accept `timezone` parameter (5 functions)

**Files:**
- Modify: `src/server/summaries.ts`

- [ ] **Step 1: Delete the module-level `REPORTING_TIMEZONE` constant**

In `src/server/summaries.ts` at line 605, remove this block entirely:

```ts
// Reporting timezone for daily bucket boundaries. Hardcoded for now because the
// PRD scopes Tokenizer to a single user; revisit when multi-tenant support is
// on the table.
const REPORTING_TIMEZONE = "Asia/Shanghai";
```

- [ ] **Step 2: Update `getDailyForDevice` (line 388 area)**

Find the function signature `export async function getDailyForDevice(tenantId: string, deviceId: string, range: RangeOption = "all")`. Add `timezone` parameter with a sensible default:

```ts
export async function getDailyForDevice(
  tenantId: string,
  deviceId: string,
  range: RangeOption = "all",
  timezone: string = "Asia/Shanghai",
) {
```

Inside the SQL body, replace `${REPORTING_TIMEZONE}` with `${timezone}`:

```ts
    SELECT
      date_trunc('day', "occurredAt" AT TIME ZONE ${timezone})::date AS date,
```

- [ ] **Step 3: Update `getDailyByDeviceImpl` (line 426 area)**

Change the signature:

```ts
async function getDailyByDeviceImpl(
  tenantId: string,
  range: RangeOption = "all",
  timezone: string = "Asia/Shanghai",
) {
```

And the SQL:

```ts
      date_trunc('day', "occurredAt" AT TIME ZONE ${timezone})::date AS date,
```

- [ ] **Step 4: Update `getDailySummaryImpl` (line 632 area)**

Signature:

```ts
async function getDailySummaryImpl(
  tenantId: string,
  range: RangeOption = "all",
  timezone: string = "Asia/Shanghai",
) {
```

SQL:

```ts
      date_trunc('day', "occurredAt" AT TIME ZONE ${timezone})::date AS date,
```

- [ ] **Step 5: Update `getDailyCostImpl` (line 672 area)**

Signature:

```ts
async function getDailyCostImpl(
  tenantId: string,
  range: RangeOption = "all",
  timezone: string = "Asia/Shanghai",
) {
```

SQL:

```ts
      date_trunc('day', "occurredAt" AT TIME ZONE ${timezone})::date AS date,
```

- [ ] **Step 6: Update `getDailyBySourceImpl` (line 716 area)**

Signature:

```ts
async function getDailyBySourceImpl(
  tenantId: string,
  range: RangeOption = "all",
  timezone: string = "Asia/Shanghai",
) {
```

SQL:

```ts
      date_trunc('day', "occurredAt" AT TIME ZONE ${timezone})::date AS date,
```

- [ ] **Step 7: Confirm no remaining references to REPORTING_TIMEZONE**

Run: `grep -n "REPORTING_TIMEZONE" src/server/summaries.ts`
Expected: zero output (no remaining references).

- [ ] **Step 8: Run typecheck**

Run: `npm run verify`
Expected: zero errors. (Existing callers in pages don't yet pass `timezone`, but the default `"Asia/Shanghai"` parameter preserves their compile compatibility — Task 11 will thread tz through.)

- [ ] **Step 9: Commit**

```bash
git add src/server/summaries.ts
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "refactor(summaries): replace hardcoded Asia/Shanghai with timezone parameter

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Refactor `format.ts` to per-tz memoized factory

**Files:**
- Modify: `src/shared/format.ts`

- [ ] **Step 1: Replace the module-level formatter setup**

In `src/shared/format.ts`, lines 1-22 currently read:

```ts
const REPORTING_TIMEZONE = "Asia/Shanghai";

const dateTimeFmt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: REPORTING_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

const dateTimeSecondsFmt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: REPORTING_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});
```

Replace with:

```ts
const DEFAULT_TIMEZONE = "Asia/Shanghai";

// Memoize Intl.DateTimeFormat per timezone. Pages call formatDateTime
// hundreds of times per render across event tables and device lists,
// and constructing Intl formatters is non-trivial.
const dateTimeCache = new Map<string, Intl.DateTimeFormat>();
const dateTimeSecondsCache = new Map<string, Intl.DateTimeFormat>();

function getDateTimeFmt(timezone: string): Intl.DateTimeFormat {
  let fmt = dateTimeCache.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("sv-SE", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    dateTimeCache.set(timezone, fmt);
  }
  return fmt;
}

function getDateTimeSecondsFmt(timezone: string): Intl.DateTimeFormat {
  let fmt = dateTimeSecondsCache.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("sv-SE", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    dateTimeSecondsCache.set(timezone, fmt);
  }
  return fmt;
}
```

- [ ] **Step 2: Update `formatRelativeTime` to accept tz**

Find the `formatRelativeTime` function (around line 81). It currently looks like:

```ts
export function formatRelativeTime(value: Date | string | null | undefined, t: (key: string, values?: Record<string, string | number>) => string): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return formatDateTime(date);
  // ... (existing body with multiple relative-time branches) ...
  return formatDateTime(date);
}
```

Add a `timezone` parameter and pass it to the `formatDateTime` fallback calls. Replace the signature and the two `formatDateTime(date)` calls inside it:

```ts
export function formatRelativeTime(
  value: Date | string | null | undefined,
  t: (key: string, values?: Record<string, string | number>) => string,
  timezone: string = DEFAULT_TIMEZONE,
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return formatDateTime(date, timezone);
  // ... keep the existing relative-time branches unchanged ...
  return formatDateTime(date, timezone);
}
```

(Leave the middle of the function — the "minutes ago", "hours ago" relative branches — entirely as they are. Only change the signature line and the two `formatDateTime` call sites inside it.)

- [ ] **Step 3: Update `formatDateTime` and `formatDateTimeSeconds`**

Find lines 96-108 (the two formatter functions). They currently read:

```ts
export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return dateTimeFmt.format(date);
}

export function formatDateTimeSeconds(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return dateTimeSecondsFmt.format(date);
}
```

Replace with:

```ts
export function formatDateTime(
  value: Date | string | null | undefined,
  timezone: string = DEFAULT_TIMEZONE,
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return getDateTimeFmt(timezone).format(date);
}

export function formatDateTimeSeconds(
  value: Date | string | null | undefined,
  timezone: string = DEFAULT_TIMEZONE,
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return getDateTimeSecondsFmt(timezone).format(date);
}
```

- [ ] **Step 4: Run typecheck**

Run: `npm run verify`
Expected: zero errors. (Existing callers don't yet pass `timezone`; the default keeps them compiling.)

- [ ] **Step 5: Commit**

```bash
git add src/shared/format.ts
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "refactor(format): per-tz memoized formatters with optional timezone arg

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: i18n parameterize `timezone.note`

**Files:**
- Modify: `messages/zh-CN.json`
- Modify: `messages/en.json`

- [ ] **Step 1: Update zh-CN**

In `messages/zh-CN.json`, find the existing `"timezone"` block (around line 293-295). It reads:

```json
  "timezone": {
    "note": "所有时间均按 Asia/Shanghai 时区 (UTC+8) 显示。"
  },
```

Replace the value with:

```json
  "timezone": {
    "note": "所有时间均按 {tz} 时区显示。"
  },
```

- [ ] **Step 2: Update en**

In `messages/en.json`, find the corresponding `"timezone"` block. It reads:

```json
  "timezone": {
    "note": "All times shown in Asia/Shanghai (UTC+8)."
  },
```

Replace with:

```json
  "timezone": {
    "note": "All times shown in {tz}."
  },
```

- [ ] **Step 3: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('messages/zh-CN.json','utf8'))" && node -e "JSON.parse(require('fs').readFileSync('messages/en.json','utf8'))" && echo OK`
Expected: prints `OK`.

- [ ] **Step 4: Run typecheck**

Run: `npm run verify`
Expected: zero errors. (Existing callers without `{ tz }` will silently render the placeholder literal `{tz}` until Task 11 updates them. That's a brief intermediate state on a single uncommitted boundary — Task 11 fixes it in the next commit.)

- [ ] **Step 5: Commit**

```bash
git add messages/zh-CN.json messages/en.json
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(i18n): parameterize timezone.note with {tz}

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Thread `tz` through all 5 page callers

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/devices/page.tsx`
- Modify: `app/events/page.tsx`
- Modify: `app/projects/[id]/page.tsx`
- Modify: `app/devices/[id]/page.tsx`

For each page below, the pattern is the same:
1. Add `import { getUserTimezone } from "@/server/timezone";` near the other server imports.
2. After `const tenantId = session.user.id;`, add: `const tz = await getUserTimezone(tenantId);`
3. Pass `tz` as the new last argument to every call of: `getDailySummary`, `getDailyByDevice`, `getDailyBySource`, `getDailyCost`, `getDailyForDevice`.
4. Pass `tz` as the last argument to every call of: `formatDateTime(...)`, `formatDateTimeSeconds(...)`, `formatRelativeTime(value, t, ...)`.
5. Find every `t("timezone.note")` call and change it to `t("timezone.note", { tz })`.

- [ ] **Step 1: Update `app/page.tsx`**

Add the import (alongside the other server imports near the top):

```tsx
import { getUserTimezone } from "@/server/timezone";
```

After `const tenantId = session.user.id;` (line ~75), add:

```tsx
const tz = await getUserTimezone(tenantId);
```

Find every call to:
- `getDailySummary(tenantId, range)` → `getDailySummary(tenantId, range, tz)`
- `getDailyCost(tenantId, range)` → `getDailyCost(tenantId, range, tz)`
- `getDailyBySource(tenantId, range)` → `getDailyBySource(tenantId, range, tz)`
- `getDailyByDevice(...)` (if present) → add `tz` as last arg
- `formatRelativeTime(value, tRelative)` → `formatRelativeTime(value, tRelative, tz)`
- `formatDateTime(value)` → `formatDateTime(value, tz)`
- `t("timezone.note")` → `t("timezone.note", { tz })`

For `formatRelativeTime` calls that are passed into JSX prop helpers (e.g., the inner section helpers that take `tRelative` and call `formatRelativeTime(date, tRelative)`), you have two choices:
- a) Threading `tz` into those helpers' signatures, OR
- b) Wrapping the relative-time call in the parent with `tz` already pre-bound.

The pragmatic approach: each inner section helper that calls `formatRelativeTime` takes `tz` as an additional prop and passes it through. Read the file, find each `formatRelativeTime(...)` call site, add `tz` to its arguments AND ensure the enclosing helper receives `tz` as a prop.

Concretely for `app/page.tsx`: the helpers `ProjectsAndDevicesSection` and similar receive `tenantId, range, ...` props. Add `tz: string` to their prop types and pass it from the parent.

Where they internally call `formatRelativeTime(project.lastActiveAt, tRelative)`, change to `formatRelativeTime(project.lastActiveAt, tRelative, tz)`.

(This page is the largest — about 6-8 mechanical replacements. Read it in full, find each affected call site, apply the pattern.)

- [ ] **Step 2: Update `app/devices/page.tsx`**

Add the import:

```tsx
import { getUserTimezone } from "@/server/timezone";
```

After `const tenantId = session.user.id;`, add:

```tsx
const tz = await getUserTimezone(tenantId);
```

Inside the page body, the existing `getDailyByDevice(tenantId, range)` call(s) get a `tz` third argument. The `<PageBanner>` `note` prop currently passes `t("timezone.note")`; change to `t("timezone.note", { tz })`.

Inside helper sections (`DailyByDeviceSection`, `DevicesTableSection`), find every `formatRelativeTime(value, tRelative)` call and pass `tz` through (you'll need to add `tz: string` to the section's props and pipe from the parent).

- [ ] **Step 3: Update `app/events/page.tsx`**

Add the import + tz resolution as above.

- The `<PageBanner>` `note` prop passes `t("timezone.note")` — change to `t("timezone.note", { tz })`.
- The event table row currently calls `formatDateTimeSeconds(event.occurredAt)` — change to `formatDateTimeSeconds(event.occurredAt, tz)`.

- [ ] **Step 4: Update `app/projects/[id]/page.tsx`**

Add the import + tz resolution.

- The `<PageBanner>` `note` prop has two `<p>` elements; one is `t("timezone.note")` — change to `t("timezone.note", { tz })`.
- Any `formatDateTimeSeconds(event.occurredAt)` or `formatRelativeTime(...)` calls take `tz` as a trailing argument.

- [ ] **Step 5: Update `app/devices/[id]/page.tsx`**

Add the import + tz resolution.

- The `<PageBanner>` `subtitle` slot uses `formatRelativeTime(device.lastSeenAt?.toISOString() ?? null, tRelative)` and `formatRelativeTime(device.lastSyncAt?.toISOString() ?? null, tRelative)` — both get `tz` appended.
- The detail page calls `getDailyForDevice(tenantId, id, range)` — change to `getDailyForDevice(tenantId, id, range, tz)`.
- Any other `formatDateTimeSeconds(...)` or `formatRelativeTime(...)` calls take `tz` as a trailing argument.

- [ ] **Step 6: Run typecheck**

Run: `npm run verify`
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx app/devices/page.tsx app/events/page.tsx 'app/projects/[id]/page.tsx' 'app/devices/[id]/page.tsx'
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(pages): thread user timezone through summaries + formatters

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Manual visual smoke test

**Files:** none modified (handed off to user)

This task is handed off to the user — subagents cannot perform browser interactions or change OS-level system timezone.

- [ ] **Step 1: Start dev server**

Run: `npm run dev`
Expected: Next.js dev server starts on `http://localhost:3000`.

- [ ] **Step 2: Verify no regression for current behavior**

Open `http://localhost:3000/` while signed in.
- Confirm the dashboard renders as before (data + layout unchanged).
- Confirm the `timezone.note` footer/note now reads "All times shown in Asia/Shanghai." (or its Chinese equivalent) — the IANA name should be present, "UTC+8" should no longer appear in this string.

- [ ] **Step 3: Verify `TimezoneReporter` fires**

Open browser DevTools → Network tab. Refresh the dashboard.
- Look for a `PATCH /api/me/timezone` request.
- Confirm it returns `200` and the response body is `{"ok":true,"timezone":"Asia/Shanghai"}` (or whatever your browser reports).

- [ ] **Step 4: Confirm DB update**

On the VPS:

```bash
ssh kolmatrix-vps 'cd /opt/tokenizer && docker compose exec -T postgres psql -U tokenizer -d tokenizer -c "SELECT email, timezone FROM \"User\" ORDER BY \"createdAt\" DESC;"'
```

Expected: your own User row now has `timezone = 'Asia/Shanghai'` (the row's prior value was NULL).

- [ ] **Step 5: Cross-timezone test (optional but recommended)**

To prove the per-user pipeline actually works for non-UTC+8 users:

a) Temporarily set your laptop's OS timezone to `America/Los_Angeles` (System Settings → Date & Time on macOS, or `sudo timedatectl set-timezone America/Los_Angeles` on Linux).

b) Restart your tokenizer agent (`tokenizer service restart` or kill-and-rerun).

c) Wait for the next sync cycle (~15 min) or trigger one manually.

d) On the VPS, confirm `User.timezone` for your row is now `'America/Los_Angeles'`.

e) Refresh the dashboard. Daily charts should re-bucket at LA midnight (you'll see "today's" data shifted by 7-8 hours compared to before).

f) Reset your OS timezone back to `Asia/Shanghai` when done. Next sync will revert User.timezone automatically.

- [ ] **Step 6: Stop dev server**

Press `Ctrl+C` in the terminal running `npm run dev`.

- [ ] **Step 7: (Only if smoke surfaced an issue)**

Fix locally, then:

```bash
git add <touched-files>
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "fix(timezone): <describe the tweak>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Summary of Commits

After Task 11 completes, the branch should contain these commits:

1. `feat(schema): add User.timezone column`
2. `feat(server): add timezone helper module + unit tests`
3. `feat(shared): add optional timezone field to BatchUsageRequest`
4. `feat(cli): attach IANA timezone to sync + heartbeat payloads`
5. `feat(api): persist User.timezone from sync + heartbeat payloads`
6. `feat(api): add PATCH /api/me/timezone endpoint`
7. `feat(login): mount TimezoneReporter on authenticated dashboard`
8. `refactor(summaries): replace hardcoded Asia/Shanghai with timezone parameter`
9. `refactor(format): per-tz memoized formatters with optional timezone arg`
10. `feat(i18n): parameterize timezone.note with {tz}`
11. `feat(pages): thread user timezone through summaries + formatters`
12. (Optional from Task 12) `fix(timezone): <tweak from smoke testing>`
