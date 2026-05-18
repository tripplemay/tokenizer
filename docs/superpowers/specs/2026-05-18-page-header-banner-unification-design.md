# Page Header Banner Unification + Add-Device Modal

**Date:** 2026-05-18
**Status:** Approved (pending spec review)

## Problem

Two related UX issues on the dashboard:

1. **Top-row text obscured by the floating navbar.** The site's Navbar is
   `sticky top-4` with a translucent `bg-white/10 backdrop-blur-xl`. On the
   home page (`/`) the page title sits inside a stylized rounded gradient
   banner card that visually separates it from the navbar. But on
   `/devices`, `/events`, `/projects/[id]`, and `/devices/[id]` the title
   is a bare `<h2>` directly under the navbar, so the navbar's translucent
   strip floats over (or visually crowds) it as the user scrolls. The
   navbar also already echoes the page title in its own brand text, which
   amplifies the crowding at the top of the page.
2. **Add-device flow expands inline as a giant card.** On `/devices`,
   clicking "添加设备" replaces the button with an in-page enrollment card.
   The user wants this to open in a modal dialog using a component
   consistent with the site's existing template style.

## Goals

- Visual consistency: every dashboard page's top row uses the same banner
  pattern as the current home page.
- No more title-vs-navbar crowding.
- Add-device flow opens in a modal that matches the template's look and
  feel, with proper a11y (ESC, focus trap, ARIA) and clean teardown of
  the enrollment polling when the modal closes.

## Non-Goals

- Navbar restyling (translucency is working as intended).
- Mobile-specific layout overhaul beyond the banner's existing flex-wrap.
- `/admin/*`, `/login` (out of scope — separate visual treatments).
- Onboarding empty state on `/`: that branch returns a full-bleed
  `OnboardingCard` and uses `EnrollFlowCard` directly (not
  `AddDeviceSection`), so it does NOT change.

## Architecture

### New shared component: `app/_components/page-banner.tsx`

A pure-presentation server-component-friendly wrapper around the existing
home-page banner JSX shell.

**Props:**

| Prop        | Type        | Notes                                                    |
|-------------|-------------|----------------------------------------------------------|
| `title`     | `ReactNode` | Required. Wrapped internally in `<h2 class="text-2xl font-bold text-navy-700 dark:text-white">`. Accepts ReactNode so callers can inline icons or status badges. |
| `subtitle`  | `ReactNode` | Optional. Below the title, below H2 weight.              |
| `note`      | `ReactNode` | Optional. Small gray helper text; can be a fragment of multiple `<p>` lines (timezone note, aggregate note, etc.). |
| `overline`  | `ReactNode` | Optional. Small link above the title (used for back-links on detail pages). |
| `rightSlot` | `ReactNode` | Optional. Right-aligned controls (RangeSelector, AddDeviceSection, etc.). |

**Rendered shell** (same DOM/classes as `app/page.tsx:99-117`):

```jsx
<div className="relative overflow-hidden rounded-3xl border border-gray-200 bg-gradient-to-br from-brand-500/10 via-white to-brand-500/5 px-6 py-5 dark:border-white/10 dark:from-brand-500/15 dark:via-navy-800 dark:to-brand-500/5">
  <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand-500/15 blur-3xl" />
  <div className="pointer-events-none absolute -bottom-20 -left-12 h-48 w-48 rounded-full bg-brand-500/10 blur-3xl" />
  <div className="relative flex flex-wrap items-start justify-between gap-3">
    <div>
      {overline}
      <h2 className="text-2xl font-bold text-navy-700 dark:text-white">{title}</h2>
      {subtitle}
      {note}
    </div>
    {rightSlot}
  </div>
</div>
```

**Why a shared component:** the banner's two decorative blur orbs and the
gradient classes are tedious to keep in sync across 5 files. One source of
truth; new pages get the look with a single call.

### New shared component: `src/components/modal/index.tsx`

Thin Tailwind-styled wrapper around `@chakra-ui/modal`, mirroring the
existing `src/components/popover/index.tsx` pattern. `@chakra-ui/modal` is
already in dependencies (unused). No `ChakraProvider` is required for
basic usage — same as the existing popover/tooltip wrappers.

**Props:**

| Prop      | Type                                | Notes                            |
|-----------|-------------------------------------|----------------------------------|
| `isOpen`  | `boolean`                           | Required.                        |
| `onClose` | `() => void`                        | Required. Fires on ESC + overlay click + close button. |
| `title`   | `ReactNode`                         | Optional header content.         |
| `size`    | `"sm" \| "md" \| "lg" \| "xl" \| "2xl"` | Default `"lg"`.              |
| `children`| `ReactNode`                         | Modal body.                      |

**Rendered structure:**

```jsx
<Modal isOpen={isOpen} onClose={onClose} size={size} isCentered>
  <ModalOverlay className="bg-black/40 backdrop-blur-sm" />
  <ModalContent className="!rounded-2xl !bg-white !shadow-2xl dark:!bg-navy-800">
    {title ? (
      <ModalHeader className="!px-6 !pt-5 !pb-2 text-lg font-bold text-navy-700 dark:text-white">
        {title}
      </ModalHeader>
    ) : null}
    <ModalCloseButton className="!top-3 !right-3 !text-gray-500 hover:!text-navy-700 dark:hover:!text-white" />
    <ModalBody className="!px-6 !pb-6 !pt-2">{children}</ModalBody>
  </ModalContent>
</Modal>
```

The `!` Tailwind important modifier is used because Chakra's `ModalContent`
ships inline styles whose specificity beats plain class rules — the same
technique already used in `src/components/popover/index.tsx`
(`dark:!bg-navy-700`).

A11y, focus trap, scroll lock, and ARIA wiring are inherited from Chakra
out of the box.

## Page-by-page application

### `app/page.tsx` — home

Replace lines 99-117 (the existing banner JSX) with:

```jsx
<PageBanner
  title={t("home.title")}
  note={<span className="text-xs text-gray-500 dark:text-gray-400">{t("timezone.note")}</span>}
  rightSlot={<RangeSelector current={range} searchParams={params} labels={...} />}
/>
```

Behavior is identical to the current home banner.

### `app/devices/page.tsx`

Replace the bare `<div className="flex flex-wrap items-start justify-between gap-3">...</div>` block (lines 76-94) with:

```jsx
<PageBanner
  title={t("devices.title")}
  subtitle={<p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t("devices.subtitle")}</p>}
  note={<p className="mt-0.5 text-xs text-gray-500">{t("timezone.note")}</p>}
  rightSlot={
    <div className="flex flex-wrap items-center gap-3">
      <AddDeviceSection initialDeviceIds={currentDevices.map((d) => d.deviceId)} />
      <DevicesRangeSelector current={range} searchParams={params} labels={...} />
    </div>
  }
/>
```

### `app/events/page.tsx`

Replace lines 30-34 with:

```jsx
<PageBanner
  title={t("events.title")}
  subtitle={<p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t("events.subtitle", { count: events.length })}</p>}
  note={<p className="mt-0.5 text-xs text-gray-500">{t("timezone.note")}</p>}
/>
```

(No `rightSlot` — banner gracefully collapses the right side.)

### `app/projects/[id]/page.tsx`

Replace lines 49-61 with:

```jsx
<PageBanner
  overline={
    <Link href="/" className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:underline">
      <MdArrowBack className="h-4 w-4" />
      {t("project.back")}
    </Link>
  }
  title={
    <span className="inline-flex items-center gap-2">
      {project.name}
      <ProjectIcon repoKey={project.repoKey} workspacePath={project.workspacePath} size="md" folderTitle={t("project.localFolderTooltip")} />
    </span>
  }
  subtitle={<p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{project.workspacePath ?? t("project.noWorkspace")}</p>}
  note={
    <>
      <p className="mt-0.5 text-xs text-gray-500">{t("project.aggregateNote")}</p>
      <p className="mt-0.5 text-xs text-gray-500">{t("timezone.note")}</p>
    </>
  }
/>
```

The "project not found" early-return branch (lines 27-39) is unchanged.

### `app/devices/[id]/page.tsx`

Replace lines 114-141 with:

```jsx
<PageBanner
  overline={
    <Link href="/devices" className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:underline">
      <MdArrowBack className="h-4 w-4" />
      {t("device.back")}
    </Link>
  }
  title={
    <span className="inline-flex flex-wrap items-center gap-2">
      <MdComputer className="h-6 w-6 text-brand-500" />
      {device.name}
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>
        {t(`clientStatus.${statusKey}`)}
      </span>
    </span>
  }
  subtitle={
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
      <span>{t("device.meta.hostname", { value: device.hostname ?? "—" })}</span>
      <span>{t("device.meta.platform", { value: device.platform ?? "—" })}</span>
      <span>{t("device.meta.lastSeen", { value: formatRelativeTime(device.lastSeenAt?.toISOString() ?? null, tRelative) })}</span>
      <span>{t("device.meta.lastSync", { value: formatRelativeTime(device.lastSyncAt?.toISOString() ?? null, tRelative) })}</span>
    </div>
  }
  rightSlot={
    <DeviceRangeSelector
      deviceId={id}
      current={range}
      labels={{ sevenDay: t("home.range.sevenDay"), thirtyDay: t("home.range.thirtyDay"), all: t("home.range.all") }}
    />
  }
/>
```

The "device not found" early-return branch (lines 94-106) is unchanged.

### `app/_components/add-device-section.tsx` — replace inline panel with modal

Full replacement:

```jsx
"use client";
import { useState } from "react";
import { MdAdd } from "react-icons/md";
import Modal from "@/components/modal";
import { EnrollFlowCard } from "./enroll-flow-card";

export function AddDeviceSection({ initialDeviceIds }: { initialDeviceIds: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600"
      >
        <MdAdd className="h-4 w-4" />
        添加设备
      </button>
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        size="2xl"
        title={
          <div>
            添加新设备
            <p className="mt-0.5 text-xs font-normal text-gray-500 dark:text-gray-400">
              生成一次性安装命令，在目标 Mac / Linux / WSL 终端运行即可。
            </p>
          </div>
        }
      >
        {open ? <EnrollFlowCard initialDeviceIds={initialDeviceIds} /> : null}
      </Modal>
    </>
  );
}
```

The custom `<MdClose>` button is removed — Chakra's built-in
`ModalCloseButton` provides ESC + click + ARIA. `EnrollFlowCard` is only
mounted while the modal is open, so closing the modal cancels any
in-flight polling cleanly (no orphan timers / network loops).

`app/_components/onboarding-card.tsx` uses `EnrollFlowCard` directly
(not `AddDeviceSection`), so the full-page empty state is unaffected.

## Edge Cases

- **Modal width on small screens:** Chakra's `size="2xl"` falls back to
  full-width on narrow viewports. The enroll flow's curl command will
  wrap; that's acceptable.
- **Re-opening the modal:** Conditional mounting of `EnrollFlowCard` means
  state resets between opens. This matches user expectations — the
  one-time install command from a previous open should not linger.
- **Banner with no `rightSlot`:** `justify-between` lets the left block
  fill the width; no special-casing needed.
- **`note` line spacing:** the caller supplies `<p className="mt-0.5
  ...">` to control vertical rhythm; the banner doesn't impose its own.
- **Dark mode:** all class lists carry `dark:` variants.

## Testing

This is presentation-only work. No unit tests warranted.

**Required checks before merge:**

1. `npm run verify` (prisma generate + `tsc --noEmit`) passes.
2. Manual visual smoke: `npm run dev`, then visit `/`, `/devices`,
   `/events`, `/projects/<id>`, `/devices/<id>` in both light and dark
   mode. Confirm:
   - No title-vs-navbar overlap at scroll-top or while scrolling.
   - Banner gradient and blur orbs render consistently across pages.
   - Right-slot controls (RangeSelector, AddDeviceSection) are aligned
     correctly.
3. Add-device flow:
   - Click "添加设备" → modal opens centered, with overlay + blur.
   - ESC closes the modal.
   - Clicking the overlay closes the modal.
   - Generating an install command, then closing the modal mid-poll:
     verify in DevTools Network panel that polling requests stop.
   - Re-opening the modal shows the idle state, not the previous command.

## Files Touched

**New:**
- `app/_components/page-banner.tsx`
- `src/components/modal/index.tsx`

**Modified:**
- `app/page.tsx`
- `app/devices/page.tsx`
- `app/events/page.tsx`
- `app/projects/[id]/page.tsx`
- `app/devices/[id]/page.tsx`
- `app/_components/add-device-section.tsx`

**Unchanged but verified for impact:**
- `app/_components/onboarding-card.tsx` (uses `EnrollFlowCard` directly,
  not affected by the modal refactor)
