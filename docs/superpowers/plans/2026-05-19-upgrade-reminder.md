# Client Upgrade Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a non-dismissible amber banner whenever the user has at least one device whose `agentVersion` differs from the server's `MIN_AGENT_SHA` constant, and add a copyable install command + per-row "outdated" badge on `/devices`.

**Architecture:** New server constant module (`src/server/agent-version.ts`) defines `MIN_AGENT_SHA` and a React 19 `cache()`-wrapped `countOutdatedDevices(userId)` helper. Root layout queries it once per request and threads `outdatedCount` + `installCommand` down to `AdminShell`, which mounts an `<UpgradeBanner>` when the count is positive. A shared `<CopyInstallCommand>` component handles the clipboard interaction in both the banner and `/devices`; an `<OutdatedBadge>` sits next to `<ClientStatusBadge>` on per-row status cells when that device is outdated.

**Tech Stack:** Next.js 15 App Router (root layout server component → client `AdminShell`), React 19 (`cache()`), TypeScript, Tailwind CSS, `next-intl` for the new `upgradeBanner.*` namespace, `react-icons/md`.

**Spec:** [docs/superpowers/specs/2026-05-19-upgrade-reminder-design.md](../specs/2026-05-19-upgrade-reminder-design.md)

**Verification model:** No React component test harness exists in this project. Per task: `npm run verify` (prisma generate + `tsc --noEmit`) exits 0. Pure-function task adds vitest cases under `tests/`. Final task is a manual visual smoke handed to the user.

**Ordering rationale:** server constants + helper first (everything else depends on `MIN_AGENT_SHA` / `isDeviceOutdated`), then leaf components (`CopyInstallCommand`, `OutdatedBadge`), then the banner that consumes them, then i18n, then the two integration points (`layout.tsx` / `admin-shell.tsx` and `/devices/page.tsx`).

**Git identity for commits:** `git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit ...` on every commit. Do NOT run `git config`.

---

## File Map

**New (5):**
- `src/server/agent-version.ts` — constants + helpers
- `app/_components/copy-install-command.tsx` — shared copy-to-clipboard block
- `app/_components/upgrade-banner.tsx` — amber top banner
- `app/_components/outdated-badge.tsx` — small "过期" pill
- `tests/server/agent-version.test.ts` — vitest pure-function tests

**Modified (4):**
- `app/layout.tsx` — query `outdatedCount`, pass with `installCommand` to AdminShell
- `app/admin-shell.tsx` — accept new props, conditionally render banner
- `app/devices/page.tsx` — render `<CopyInstallCommand>` card + `<OutdatedBadge>` per row
- `messages/zh-CN.json`, `messages/en.json` — `upgradeBanner.*` + `devices.upgrade.*` + `devices.outdatedBadge`

---

## Task 1: Server constants + helper + unit tests

**Files:**
- Create: `src/server/agent-version.ts`
- Create: `tests/server/agent-version.test.ts`

- [ ] **Step 1: Write the failing tests first (TDD)**

Write `tests/server/agent-version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isDeviceOutdated, MIN_AGENT_SHA } from "@/server/agent-version";

describe("isDeviceOutdated", () => {
  it("returns false when agentVersion matches MIN_AGENT_SHA", () => {
    expect(isDeviceOutdated(MIN_AGENT_SHA)).toBe(false);
  });

  it("returns true for any other non-empty SHA", () => {
    expect(isDeviceOutdated("aaaaaaaaaaaa")).toBe(true);
    expect(isDeviceOutdated("af8708390285")).toBe(true);
    expect(isDeviceOutdated("d31acc94822a")).toBe(true);
  });

  it("returns false for null, undefined, and empty string", () => {
    expect(isDeviceOutdated(null)).toBe(false);
    expect(isDeviceOutdated(undefined)).toBe(false);
    expect(isDeviceOutdated("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test — expect it to fail**

Run: `npm run test -- tests/server/agent-version.test.ts`
Expected: FAIL with "Cannot find module '@/server/agent-version'".

- [ ] **Step 3: Create the server module**

Write `src/server/agent-version.ts`:

```ts
import { cache } from "react";
import { prisma } from "./db";

// Bump when a server-side feature relies on client-side code changes
// (e.g., new parser fields, new agent loop responsibilities). Devices
// reporting any other SHA will be prompted to upgrade.
//
// History (newest first):
//   8101f94 — 2026-05-19: Codex quota poll + Claude JSONL enrichment
//   c4bc2f2 — 2026-05-19: timezone capture
export const MIN_AGENT_SHA = "8101f94";

// The curl install URL — kept in code so it's easy to point staging at
// a different host during testing. Production is token.vpanel.cc.
export const INSTALL_COMMAND =
  "curl -fsSL https://token.vpanel.cc/install.sh | bash";

export function isDeviceOutdated(agentVersion: string | null | undefined): boolean {
  // Devices that have never reported a version (agentVersion === null)
  // are ignored — they're either freshly enrolled and haven't completed
  // their first heartbeat yet, or running such an old agent it predates
  // the agentVersion field. Either way, prompting them now adds noise
  // without clear action.
  if (!agentVersion) return false;
  return agentVersion !== MIN_AGENT_SHA;
}

// React 19 cache() — multiple calls per render dedup. Not unstable_cache
// because we want a device's just-completed upgrade to reflect on the
// next render (no stale 30s window).
export const countOutdatedDevices = cache(async (userId: string): Promise<number> => {
  const devices = await prisma.device.findMany({
    where: { userId },
    select: { agentVersion: true },
  });
  return devices.filter((d) => isDeviceOutdated(d.agentVersion)).length;
});
```

- [ ] **Step 4: Run the test — expect it to pass**

Run: `npm run test -- tests/server/agent-version.test.ts`
Expected: 3 test cases pass (one with multiple assertions in case 2).

- [ ] **Step 5: Run verify**

Run: `npm run verify`
Expected: zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/server/agent-version.ts tests/server/agent-version.test.ts
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(server): add agent-version constants + outdated helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Shared `CopyInstallCommand` component

**Files:**
- Create: `app/_components/copy-install-command.tsx`

- [ ] **Step 1: Create the component**

Write `app/_components/copy-install-command.tsx`:

```tsx
"use client";

import { useState } from "react";
import { MdCheck, MdContentCopy } from "react-icons/md";
import { useTranslations } from "next-intl";

type Variant = "banner" | "card";

const VARIANT_STYLES: Record<Variant, { code: string; button: string }> = {
  banner: {
    code: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-100",
    button:
      "bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-100 dark:hover:bg-amber-500/25",
  },
  card: {
    code: "bg-gray-100 text-navy-700 dark:bg-white/5 dark:text-gray-100",
    button:
      "bg-gray-100 text-navy-700 hover:bg-gray-200 dark:bg-white/5 dark:text-gray-100 dark:hover:bg-white/10",
  },
};

// Reusable code-block + copy-button. Used by the upgrade banner (amber
// variant) and the /devices "Upgrade all devices" card (gray variant).
// navigator.clipboard may throw on non-HTTPS origins; we swallow the
// error silently and leave the button text unchanged so users can still
// select + Ctrl+C manually.
export function CopyInstallCommand({
  command,
  variant,
}: {
  command: string;
  variant: Variant;
}) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  const styles = VARIANT_STYLES[variant];

  return (
    <div className="flex items-center gap-2">
      <code className={`flex-1 truncate rounded-md px-2 py-1 font-mono text-xs ${styles.code}`}>
        {command}
      </code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(command);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // clipboard API unavailable; ignore
          }
        }}
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${styles.button}`}
      >
        {copied ? <MdCheck className="h-3 w-3" /> : <MdContentCopy className="h-3 w-3" />}
        {copied ? t("upgradeBanner.copied") : t("upgradeBanner.copy")}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Run verify**

Run: `npm run verify`
Expected: zero TypeScript errors. (The i18n keys `upgradeBanner.copied` / `upgradeBanner.copy` don't exist yet — that's fine because next-intl only validates at runtime. They'll be added in Task 5 before any rendering happens.)

- [ ] **Step 3: Commit**

```bash
git add app/_components/copy-install-command.tsx
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(ui): add CopyInstallCommand shared component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `UpgradeBanner` component

**Files:**
- Create: `app/_components/upgrade-banner.tsx`

- [ ] **Step 1: Create the component**

Write `app/_components/upgrade-banner.tsx`:

```tsx
import { MdWarningAmber } from "react-icons/md";
import { getTranslations } from "next-intl/server";
import { CopyInstallCommand } from "./copy-install-command";

// Server-component banner. Rendered by AdminShell only when count > 0.
// The interactive copy logic lives in <CopyInstallCommand>, which is
// itself a client component — that's the only piece that needs to be
// client-side. The banner shell stays server-rendered for fast first
// paint.
export async function UpgradeBanner({
  count,
  command,
}: {
  count: number;
  command: string;
}) {
  const t = await getTranslations();
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
      <div className="flex items-start gap-3">
        <MdWarningAmber className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            {t("upgradeBanner.message", { count })}
          </p>
          <div className="mt-2">
            <CopyInstallCommand command={command} variant="banner" />
          </div>
        </div>
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
git add app/_components/upgrade-banner.tsx
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(ui): add UpgradeBanner server component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `OutdatedBadge` component

**Files:**
- Create: `app/_components/outdated-badge.tsx`

- [ ] **Step 1: Create the component**

Write `app/_components/outdated-badge.tsx`:

```tsx
import { MdUpdate } from "react-icons/md";
import { useTranslations } from "next-intl";

// Pure-presentational badge. Caller is responsible for gating with
// isDeviceOutdated(); this component does NOT re-check, so passing a
// matching SHA would still render the badge. That's deliberate — keeps
// the component free of server-side imports.
export function OutdatedBadge({ agentVersion }: { agentVersion: string | null }) {
  const t = useTranslations();
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
      title={`agent ${agentVersion ?? "unknown"}`}
    >
      <MdUpdate className="h-3 w-3" />
      {t("devices.outdatedBadge")}
    </span>
  );
}
```

Note: this is a client component (uses `useTranslations` from `next-intl`'s client export). The `/devices` page is a server component that renders OutdatedBadge inside table rows — that's fine; the server-rendered page boundary handles the client-component children naturally.

If the linter / next.js requires explicit `"use client"` for `useTranslations`, add it at the top of the file. Per next-intl docs, the server export is `next-intl/server` (`getTranslations`) and the client export is `next-intl` (`useTranslations`). Files using `useTranslations` without `"use client"` are inferred as client components by Next when imported from a server component, but adding the directive explicitly is safer.

Final content with `"use client"`:

```tsx
"use client";

import { MdUpdate } from "react-icons/md";
import { useTranslations } from "next-intl";

export function OutdatedBadge({ agentVersion }: { agentVersion: string | null }) {
  const t = useTranslations();
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
      title={`agent ${agentVersion ?? "unknown"}`}
    >
      <MdUpdate className="h-3 w-3" />
      {t("devices.outdatedBadge")}
    </span>
  );
}
```

- [ ] **Step 2: Run verify**

Run: `npm run verify`
Expected: zero TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add app/_components/outdated-badge.tsx
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(ui): add OutdatedBadge

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: i18n keys

**Files:**
- Modify: `messages/zh-CN.json`
- Modify: `messages/en.json`

- [ ] **Step 1: Add `upgradeBanner` namespace + `devices.upgrade` + `devices.outdatedBadge` to zh-CN.json**

In `messages/zh-CN.json`, locate a sensible insertion point near the bottom (e.g. after the existing `subscription` block and before `admin`). Add the new top-level `upgradeBanner` block:

```json
  "upgradeBanner": {
    "message": "{count} 台设备运行较早的客户端代码。升级以启用最新功能（时区采集、Codex 配额追踪、Claude tier 徽章等）。",
    "copy": "复制",
    "copied": "已复制"
  },
```

In the same file, find the existing `"devices": { ... }` block. Inside it, after the existing keys (e.g. `col.lastSeen` or wherever the existing block ends), add:

```json
    "upgrade": {
      "title": "升级所有设备",
      "subtitle": "在每台设备上运行以下命令，自动 pull 最新代码并重启 agent。"
    },
    "outdatedBadge": "过期",
```

Mind the trailing commas inside the existing `devices` object — sibling keys must continue to parse.

- [ ] **Step 2: Mirror in en.json**

Insert `upgradeBanner` at the same logical position:

```json
  "upgradeBanner": {
    "message": "{count} devices are running outdated agents. Upgrade to enable the latest features (timezone capture, Codex quota tracking, service-tier badges).",
    "copy": "Copy",
    "copied": "Copied"
  },
```

Inside the existing `devices` block:

```json
    "upgrade": {
      "title": "Upgrade all devices",
      "subtitle": "Run this on each device to pull the latest code and restart the agent."
    },
    "outdatedBadge": "outdated",
```

- [ ] **Step 3: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('messages/zh-CN.json','utf8')); JSON.parse(require('fs').readFileSync('messages/en.json','utf8')); console.log('JSON OK')"`
Expected: prints `JSON OK`.

- [ ] **Step 4: Run verify**

Run: `npm run verify`
Expected: zero TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add messages/zh-CN.json messages/en.json
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(i18n): add upgradeBanner namespace + devices.upgrade

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Wire UpgradeBanner into root layout + AdminShell

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/admin-shell.tsx`

- [ ] **Step 1: Update `app/layout.tsx`**

Read the current file. It looks roughly like:

```tsx
import "./globals.css";
// ... other imports ...
import { AdminShell } from "./admin-shell";
import { AuthProvider } from "./session-provider";

export const metadata: Metadata = { title: "Tokenizer", description: "..." };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale}>
      <body id="root">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AuthProvider>
            <AdminShell>{children}</AdminShell>
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

Update it to fetch the outdated count + install command and pass them to `AdminShell`. Add the new imports near the existing ones:

```tsx
import { auth } from "@/auth";
import { countOutdatedDevices, INSTALL_COMMAND } from "@/server/agent-version";
```

Update the function body:

```tsx
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const session = await auth();
  const outdatedCount = session?.user?.id
    ? await countOutdatedDevices(session.user.id)
    : 0;
  return (
    <html lang={locale}>
      <body id="root">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AuthProvider>
            <AdminShell outdatedCount={outdatedCount} installCommand={INSTALL_COMMAND}>
              {children}
            </AdminShell>
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

`auth()` is the existing Auth.js v5 export from `@/auth`. It returns `null` for unauthenticated requests, in which case `outdatedCount` stays 0 and the banner won't render.

- [ ] **Step 2: Update `app/admin-shell.tsx`**

Read the current file. Find the function signature and the early-return for `/login` routes (already present from the login-beautification feature):

```tsx
export function AdminShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  if (isWindowAvailable()) document.documentElement.dir = "ltr";

  if (pathname?.startsWith("/login")) return <>{children}</>;

  return (
    <div className="flex h-full w-full bg-background-100 dark:bg-background-900">
      ...
```

Add the `UpgradeBanner` import:

```tsx
import { UpgradeBanner } from "./_components/upgrade-banner";
```

Widen the props type and accept the two new props:

```tsx
export function AdminShell({
  outdatedCount,
  installCommand,
  children,
}: {
  outdatedCount: number;
  installCommand: string;
  children: React.ReactNode;
}) {
```

Inside the JSX, locate the existing `<Navbar ... />` element near the top of the `<main>` block. After that `<Navbar />`'s closing tag, and BEFORE the existing `<div className="mx-auto min-h-screen p-2 !pt-[10px] md:p-2">{children}</div>` block, insert:

```tsx
{outdatedCount > 0 && (
  <div className="mx-auto px-2 pt-2 md:px-2">
    {/* @ts-expect-error Async Server Component */}
    <UpgradeBanner count={outdatedCount} command={installCommand} />
  </div>
)}
```

The `@ts-expect-error` comment is the standard Next.js workaround for using async server components inside client components — `UpgradeBanner` is an async server component, `AdminShell` is a client component. (If a future Next.js version removes the need for this comment, it can be deleted.)

If TypeScript surfaces a different error, drop the `@ts-expect-error` and use Next's Server Action / route-level rendering instead, but the standard pattern should work here since async children of client components are supported in Next 15.

- [ ] **Step 3: Run verify**

Run: `npm run verify`
Expected: zero TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx app/admin-shell.tsx
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(layout): render UpgradeBanner when devices need upgrade

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `/devices` page — install card + per-row badge

**Files:**
- Modify: `app/devices/page.tsx`

- [ ] **Step 1: Read existing `/devices` page**

Read `/mnt/c/Users/tripplezhou/project/tokenizer/app/devices/page.tsx`. Note:
- The page uses a `<PageBanner>` at top (with title, subtitle, controls)
- A `<Suspense fallback={<ChartCardSkeleton ... />}><DailyByDeviceSection ... /></Suspense>` block
- A `<Suspense fallback={<DevicesTableSkeleton ... />}><DevicesTableSection ... /></Suspense>` block
- The `<DevicesTableSection>` helper renders a `<Card>` with a `<table>` inside; each row has a status `<td>` containing `<ClientStatusBadge>`.

- [ ] **Step 2: Add new imports**

Near existing imports at the top of `app/devices/page.tsx`, add:

```tsx
import Card from "@/components/card";
import { INSTALL_COMMAND, isDeviceOutdated } from "@/server/agent-version";
import { CopyInstallCommand } from "../_components/copy-install-command";
import { OutdatedBadge } from "../_components/outdated-badge";
```

If `Card` is already imported (it likely is, since the file renders other Cards), do not add it again.

- [ ] **Step 3: Add the "Upgrade all devices" Card above the table**

In the page's main return JSX, find where `<DevicesTableSection ... />` is rendered (probably inside a Suspense). Above that Suspense (and above the chart suspense too — the upgrade card sits between the `<PageBanner>` and the table area):

```tsx
<Card extra="p-6">
  <h3 className="text-lg font-bold text-navy-700 dark:text-white">
    {t("devices.upgrade.title")}
  </h3>
  <p className="mt-1 mb-3 text-sm text-gray-500 dark:text-gray-400">
    {t("devices.upgrade.subtitle")}
  </p>
  <CopyInstallCommand command={INSTALL_COMMAND} variant="card" />
</Card>
```

This is rendered in the main `<DevicesPage>` component body (a server component using `getTranslations` already). The `t` function is the same one already in scope.

Exact placement: AFTER the `<PageBanner ... />` element, BEFORE the first `<Suspense fallback={<ChartCardSkeleton .../>}><DailyByDeviceSection .../></Suspense>` block. The visual order is:

```
PageBanner
↓
Upgrade card (new)
↓
DailyByDeviceSection (chart)
↓
DevicesTableSection (table)
```

- [ ] **Step 4: Add `<OutdatedBadge>` to each device row**

In the helper `DevicesTableSection`, find the `<td>` that renders the `<ClientStatusBadge ... />`. Currently it looks like:

```tsx
<td className="py-2.5 pr-4">
  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{t(`clientStatus.${key}`)}</span>
</td>
```

Change it to wrap the badge plus a conditional `<OutdatedBadge>` in an inline-flex span:

```tsx
<td className="py-2.5 pr-4">
  <span className="inline-flex flex-wrap items-center gap-1.5">
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {t(`clientStatus.${key}`)}
    </span>
    {isDeviceOutdated(device.agentVersion) && (
      <OutdatedBadge agentVersion={device.agentVersion} />
    )}
  </span>
</td>
```

`device.agentVersion` is part of the existing device summary type — confirm by inspecting the `getDeviceSummary` return type if uncertain. The field is `string | null`.

- [ ] **Step 5: Run verify**

Run: `npm run verify`
Expected: zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add app/devices/page.tsx
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(devices): show upgrade card + per-row outdated badge

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Manual visual smoke test

**Files:** none (handed off to user)

Subagents cannot perform browser interactions, OS clipboard checks, or live SSH-based upgrades. This task is the user's responsibility.

- [ ] **Step 1: Start dev server**

Run: `npm run dev`
Expected: Next.js starts on `http://localhost:3000`.

- [ ] **Step 2: Verify the banner appears on the home page**

Open `http://localhost:3000/` while signed in. At the top of the content area (below the navbar, above the first PageBanner), an amber-toned banner should appear with text like:

> "6 台设备运行较早的客户端代码。升级以启用最新功能（时区采集、Codex 配额追踪、Claude tier 徽章等）。"

Below the text is a code block with `curl -fsSL https://token.vpanel.cc/install.sh | bash` and a "复制" button.

The count "6" should match the current production reality (all 6 devices are pre-`8101f94`).

- [ ] **Step 3: Verify the copy button**

Click "复制". The button label briefly flips to "已复制" (with a check icon) for 1.5s. Paste into a terminal — clipboard should contain `curl -fsSL https://token.vpanel.cc/install.sh | bash` exactly.

If the browser is on `http://localhost` (not HTTPS), `navigator.clipboard.writeText` may throw silently. In that case manually select the code block and Ctrl+C.

- [ ] **Step 4: Verify the banner appears on every dashboard route**

Click through `/devices`, `/events`, `/projects/<id>`, `/devices/<id>`. The same banner should appear at the top of each (because it's mounted in `AdminShell`, not on any specific page).

- [ ] **Step 5: Verify `/devices` page enhancements**

On `/devices`:
- A gray "升级所有设备" Card sits between the page banner and the chart, with the same install command + copy button (gray variant instead of amber).
- The device table's "状态" column for each row contains both the existing `Online/Offline/...` badge AND a small amber "过期" pill next to it (assuming the device's agentVersion is not `8101f94`).

- [ ] **Step 6: Verify the banner is hidden on `/login`**

Visit `http://localhost:3000/login` (sign out first if needed). The amber banner should NOT appear — AdminShell short-circuits on `/login*` routes.

- [ ] **Step 7: Verify upgrade-then-recheck flow**

Pick one of your devices. SSH to it and run the copied command: `curl -fsSL https://token.vpanel.cc/install.sh | bash`. Wait 1-2 minutes for the next heartbeat. Refresh the dashboard:

- Banner count: was 6, should now be 5
- That device's row on `/devices`: the "过期" pill should be gone

- [ ] **Step 8: Verify the banner disappears when all devices are current**

Upgrade all 6 devices. Wait for the last heartbeat. Refresh:
- Banner: gone
- `/devices` page: no "过期" pills on any row
- The "升级所有设备" Card is still visible (it's not gated on outdatedCount)

- [ ] **Step 9: Verify dark mode**

Toggle dark mode via the navbar. Reload. The amber banner, the gray upgrade card, and the per-row "过期" pill should all render correctly in dark mode (no white-on-white, no invisible text).

- [ ] **Step 10: Stop dev server**

Press `Ctrl+C` in the terminal running `npm run dev`.

- [ ] **Step 11: Optional final commit (only if smoke surfaced a tweak)**

If everything passed cleanly: nothing to commit; the previous 7 commits cover the work.

If a visible regression required a fix:

```bash
git add <touched-files>
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "fix(upgrade-reminder): <describe the tweak>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Summary of Commits

After Task 7 completes, the branch should contain these commits:

1. `feat(server): add agent-version constants + outdated helper`
2. `feat(ui): add CopyInstallCommand shared component`
3. `feat(ui): add UpgradeBanner server component`
4. `feat(ui): add OutdatedBadge`
5. `feat(i18n): add upgradeBanner namespace + devices.upgrade`
6. `feat(layout): render UpgradeBanner when devices need upgrade`
7. `feat(devices): show upgrade card + per-row outdated badge`
8. (Optional from Task 8) `fix(upgrade-reminder): <tweak from smoke testing>`
