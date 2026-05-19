# Client Upgrade Reminder

**Date:** 2026-05-19
**Status:** Approved (pending spec review)

## Problem

After shipping the timezone capture and the Codex subscription quota
features today, all 6 production devices remain on old agent versions
(see git log for the table). Users don't know their data is incomplete
because the dashboard silently treats missing fields as zero/null.
Specifically, devices on old agents miss:

- Timezone reporting → dashboard renders all times in Asia/Shanghai
  fallback for that user
- Codex quota poll → home page subscription card stays in empty state
- Claude JSONL enrichment → `serviceTier` always null, no priority/batch
  badge on `/events`

The dashboard needs to surface this gap. Users should see "your devices
are running outdated code; here's the one-line fix" without us having to
chase them in chat.

## Goals

- Non-dismissible top banner on every dashboard route when any of the
  user's devices report a `Device.agentVersion` other than the server's
  declared `MIN_AGENT_SHA`.
- Banner includes the install command in a copyable code block so
  fixing the problem is one paste away.
- `/devices` page gets two enhancements:
  - A shared "Upgrade all devices" card above the table with the same
    install command (visible even when no devices are outdated, so users
    can still self-serve a reinstall)
  - Per-row "outdated" badge next to the existing
    `ClientStatusBadge`, only when that device is outdated

## Non-Goals

- Automatic OTA upgrades (the agent does not self-update; user runs
  curl on each machine)
- Per-device snooze ("don't remind me about this device again")
- Changelog modal after upgrade
- Email / push notifications
- Severity tiers — single "outdated" state, no "critical" vs "advisory"
  distinction
- Onboarding empty state — the OnboardingCard takes over the whole
  page; the banner does not display there

## Architecture

```
[CLI agent] git rev-parse --short=12 HEAD → Device.agentVersion (existing)
       │
       ▼
[Server constants in src/server/agent-version.ts]
       │ MIN_AGENT_SHA = "8101f94" — hand-bumped per release
       │ INSTALL_COMMAND = "curl -fsSL https://token.vpanel.cc/install.sh | bash"
       │
       ▼
[countOutdatedDevices(userId)] — React cache(), per-render dedup
       │ devices.filter(d => isDeviceOutdated(d.agentVersion)).length
       │
       ▼
[app/layout.tsx] reads session + outdatedCount, passes both to AdminShell
       │
       ▼
[app/admin-shell.tsx] if (outdatedCount > 0) render <UpgradeBanner count={N} command={...} />
       │
       │ and on /devices page:
       │   - <CopyInstallCommand variant="card" /> above the table
       │   - <OutdatedBadge /> next to each per-device ClientStatusBadge
       ▼
[User sees banner → copies command → SSH'es to each device → curl + bash]
```

Two principles inform the design:

1. **Single source of truth for the SHA.** `MIN_AGENT_SHA` is a server
   constant updated by a deliberate commit. No env var, no
   YAML config, no admin UI. Every bump is reviewable.
2. **No false alarms on "version unknown."**
   `isDeviceOutdated(null) === false`. Devices without a reported
   version (just-enrolled or pre-`agentVersion`-field old) aren't
   flagged.

## Server-side detection

`src/server/agent-version.ts` (new, ~40 lines):

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

export const INSTALL_COMMAND =
  "curl -fsSL https://token.vpanel.cc/install.sh | bash";

export function isDeviceOutdated(agentVersion: string | null | undefined): boolean {
  if (!agentVersion) return false;
  return agentVersion !== MIN_AGENT_SHA;
}

// React 19 cache() — multiple calls per render dedup. Not unstable_cache
// because we want a device's just-completed upgrade to reflect on next
// render (no stale 30s window).
export const countOutdatedDevices = cache(async (userId: string): Promise<number> => {
  const devices = await prisma.device.findMany({
    where: { userId },
    select: { agentVersion: true },
  });
  return devices.filter((d) => isDeviceOutdated(d.agentVersion)).length;
});
```

Why no `unstable_cache`: a user who just upgraded a device should see
the count decrement on the very next render. A 30s window would feel
broken.

## UI: top banner

New: `app/_components/upgrade-banner.tsx` (~50 lines, client component).
Renders an amber-toned advisory bar with:

- Warning icon + headline `{count} 台设备运行较早的客户端代码。升级以
  启用最新功能（时区采集、Codex 配额追踪、Claude tier 徽章等）。`
- A code block with the install command, plus a copy button using
  `navigator.clipboard.writeText`. Copy button briefly switches to "已复制"
  for 1.5s after success.
- Failure mode for `navigator.clipboard` (e.g., http origin): swallow
  error silently. User can still manually select + Ctrl+C.

Colors: `bg-amber-50 border-amber-200 text-amber-800` (light) /
`bg-amber-500/10 border-amber-500/30 text-amber-200` (dark).

### Mounting

`app/admin-shell.tsx` accepts new props `outdatedCount: number` and
`installCommand: string`. Renders `<UpgradeBanner ... />` between the
existing `<Navbar />` and the children slot, **only when
`outdatedCount > 0`**. The existing `/login` short-circuit at the top
of `AdminShell` is unchanged, so unauthenticated visitors never see the
banner.

`app/layout.tsx` (the only root layout) is the natural place to fetch
`outdatedCount`. It already awaits a session in the Auth.js setup, so
adding one more `await countOutdatedDevices(session.user.id)` is cheap
(O(devices), tiny query). The prop flows down:

```tsx
const session = await auth();
const outdatedCount = session?.user?.id
  ? await countOutdatedDevices(session.user.id)
  : 0;
return (
  <html ...>
    <body ...>
      <NextIntlClientProvider ...>
        <AuthProvider>
          <AdminShell outdatedCount={outdatedCount} installCommand={INSTALL_COMMAND}>
            {children}
          </AdminShell>
        </AuthProvider>
      </NextIntlClientProvider>
    </body>
  </html>
);
```

## UI: `/devices` page enhancements

### Shared "Upgrade all devices" card above the table

New: `app/_components/copy-install-command.tsx` — a small client
component encapsulating the code block + copy button. Two visual
variants:

- `variant="banner"`: amber (used by `UpgradeBanner`)
- `variant="card"`: gray (used on `/devices` standalone card)

Same underlying component, just different color tokens. Single source
of truth for the `navigator.clipboard` logic.

`/devices` page renders the card variant above the device table:

```tsx
<Card extra="p-6">
  <h3 className="text-lg font-bold ...">{t("devices.upgrade.title")}</h3>
  <p className="mt-1 text-sm text-gray-500 ...">
    {t("devices.upgrade.subtitle")}
  </p>
  <CopyInstallCommand variant="card" command={INSTALL_COMMAND} />
</Card>
```

This card shows even when zero devices are outdated — it's a self-serve
utility, not a warning.

### Per-row "outdated" badge

New: `app/_components/outdated-badge.tsx` (~15 lines, pure
presentation):

```tsx
import { MdUpdate } from "react-icons/md";

export function OutdatedBadge({ agentVersion }: { agentVersion: string | null }) {
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
      title={`agent ${agentVersion ?? "unknown"} · 升级到最新版本`}
    >
      <MdUpdate className="h-3 w-3" />
      过期
    </span>
  );
}
```

Caller (in `app/devices/page.tsx`) gates the render with
`isDeviceOutdated(device.agentVersion)`. The badge sits alongside the
existing `ClientStatusBadge` in the status column — no new column.

```tsx
<td>
  <span className="inline-flex flex-wrap items-center gap-1.5">
    <ClientStatusBadge ... />
    {isDeviceOutdated(device.agentVersion) && (
      <OutdatedBadge agentVersion={device.agentVersion} />
    )}
  </span>
</td>
```

The pre-existing `DiagnosticsBadges` (showing short SHA, queue depth,
last error) is unchanged. SHA + outdated badge sit on different
columns: SHA is informational forensics, outdated is the upgrade
prompt.

## i18n changes (zh-CN + en)

New `upgradeBanner.*` namespace:

```json
"upgradeBanner": {
  "message": "{count} 台设备运行较早的客户端代码。升级以启用最新功能（时区采集、Codex 配额追踪、Claude tier 徽章等）。",
  "copy": "复制",
  "copied": "已复制"
}
```

```json
"upgradeBanner": {
  "message": "{count} devices are running outdated agents. Upgrade to enable the latest features (timezone capture, Codex quota tracking, service-tier badges).",
  "copy": "Copy",
  "copied": "Copied"
}
```

New under existing `devices` namespace:

```json
"devices": {
  ...
  "upgrade": {
    "title": "升级所有设备",
    "subtitle": "在每台设备上运行以下命令，自动 pull 最新代码并重启 agent。"
  },
  "outdatedBadge": "过期"
}
```

English mirror: `"Upgrade all devices"` / `"Run this on each device to pull the latest code and restart the agent."` / `"outdated"`.

## Edge cases

- **`agentVersion === null` / `undefined`**: never flagged outdated.
  Avoids noise from just-enrolled devices and pre-`agentVersion`
  agents.
- **Empty device list**: banner doesn't render (count = 0). `/devices`
  page still shows the "Upgrade all devices" card for first-time
  installs.
- **Multi-tab usage**: each tab queries independently. Upgrade in one
  tab → next refresh in any tab catches the new state.
- **Just-upgraded device, not yet heartbeated**: banner count is stale
  for ≤ 60s (one heartbeat cycle). Acceptable.
- **Banner displayed on `/login`**: prevented by AdminShell's
  `pathname?.startsWith("/login")` short-circuit (added in an earlier
  feature).
- **Dark mode**: every amber utility has a `dark:` counterpart.
- **HTTPS clipboard restriction**: `navigator.clipboard.writeText`
  throws on http origins. Wrapped in try/catch — user can still select
  + Ctrl+C manually.
- **`MIN_AGENT_SHA` matches one of the user's devices**: that device is
  considered up-to-date; the badge / count don't include it. Correct.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Forgetting to bump `MIN_AGENT_SHA` when shipping new client-dependent features | Medium | History comment at the constant's definition lists past bumps with rationale. A future CI lint could check that PRs touching `src/cli/`, `src/parsers/`, or `src/quota/` also bump the constant. |
| Accidentally bumping `MIN_AGENT_SHA` to a non-existent SHA → all devices wrongly flagged outdated | Low | Single source in `agent-version.ts`; review at PR time; revert is a 1-commit operation. |
| `navigator.clipboard` failure on http origin → user thinks copy worked when it didn't | Low | Button only flips to "已复制" inside the `.then`/success branch. Failure leaves the button as-is. User can still manually select. |
| `app/layout.tsx` adds a DB query per page render | Very Low | Query is `findMany` on `Device(userId)` selecting only `agentVersion` — small (< 10 rows / user). `cache()` dedups within one render. |
| Banner stacks awkwardly with the existing `<PageBanner>` on `/`, `/devices`, etc. | Low | Banner is compact (≤80px high); the existing PageBanner is below it. Visual hierarchy is intentional. |
| Old data — devices that haven't heartbeated since the field was added show as null | Acceptable | Treated as "unknown, don't badge" per the design. Users with truly stale devices see no badge — but they wouldn't be reading the dashboard anyway. |

## Testing

Project has no React component test harness. Verification:

1. `npm run verify` — prisma generate + `tsc --noEmit` exits 0
2. `npm run test` — run new vitest cases
3. Manual visual smoke (handed off to user; see below)

### Vitest unit tests

`tests/server/agent-version.test.ts` (new, ~30 lines, pure-function
tests with no DB dependency):

```ts
describe("isDeviceOutdated", () => {
  it("returns false when agentVersion matches MIN_AGENT_SHA", () => {
    expect(isDeviceOutdated(MIN_AGENT_SHA)).toBe(false);
  });
  it("returns true for any other non-empty SHA", () => {
    expect(isDeviceOutdated("aaaaaaaaaaaa")).toBe(true);
  });
  it("returns false for null / undefined / empty string", () => {
    expect(isDeviceOutdated(null)).toBe(false);
    expect(isDeviceOutdated(undefined)).toBe(false);
    expect(isDeviceOutdated("")).toBe(false);
  });
});
```

5 cases. Tiny but guards against accidental regression of the
null/empty fallback, which is the subtle correctness point.

### Manual smoke (user)

1. Load home page → top of content area shows amber banner: "6 台设备
   运行较早的客户端代码…"
2. Click "复制" → clipboard has the curl command; button briefly says
   "已复制"
3. Visit `/devices` → see the gray "升级所有设备" card above the table;
   each device row's status column has a "过期" amber pill next to its
   Online/Offline badge
4. SSH to one device, run the copied command; wait 1-2 min for
   heartbeat; refresh dashboard → banner count drops by 1; that device's
   row no longer has the badge
5. Upgrade all devices → banner disappears entirely
6. Dark mode: toggle from navbar, re-load → all amber colors render
   correctly in dark mode

## Files touched

**New (5):**
- `src/server/agent-version.ts`
- `app/_components/upgrade-banner.tsx`
- `app/_components/copy-install-command.tsx`
- `app/_components/outdated-badge.tsx`
- `tests/server/agent-version.test.ts`

**Modified (4):**
- `app/layout.tsx` — query outdatedCount, pass to AdminShell
- `app/admin-shell.tsx` — accept props, conditionally render banner
- `app/devices/page.tsx` — add upgrade card above table; add
  OutdatedBadge in status column
- `messages/zh-CN.json`, `messages/en.json` — new keys

**Unchanged but verified for impact:**
- `src/cli/sync.ts`, `src/cli/agent-version.ts` — client already
  reports `agentVersion`; no client-side change needed.
- `src/server/auth-session.ts`, `src/auth.ts` — session shape
  unchanged.
- `app/_components/page-banner.tsx`, existing devices `PageBanner` usage —
  stacking with upgrade banner is by design (upgrade banner above
  PageBanner), no layout regression.

## Operational note: bumping `MIN_AGENT_SHA`

Workflow for the developer shipping a new client-side capability:

1. Implement the feature (changes in `src/cli/`, `src/parsers/`,
   `src/quota/`, etc.)
2. Merge to `main`. Note the resulting commit SHA.
3. Open a follow-up PR that:
   - Updates `MIN_AGENT_SHA` to the SHA from step 2
   - Adds an entry to the history comment above the constant
   - Optionally tweaks `upgradeBanner.message` to mention the new
     capability
4. Merge and deploy

This 2-PR pattern keeps the "ship feature" commit clean (and revertable
without un-prompting users) and the "tell users to upgrade" commit
deliberate.
