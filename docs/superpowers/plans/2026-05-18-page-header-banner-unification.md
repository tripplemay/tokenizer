# Page Header Banner Unification + Add-Device Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap five dashboard page headers (home, /devices, /events, /projects/[id], /devices/[id]) in a shared `PageBanner` component so the floating navbar no longer crowds the title, and convert the inline "Add Device" expansion on /devices into a modal dialog.

**Architecture:** Two new components — `app/_components/page-banner.tsx` (pure-presentation banner shell extracted from the home page) and `src/components/modal/index.tsx` (thin Tailwind-styled wrapper around `@chakra-ui/modal`, mirroring the existing popover/tooltip wrappers). Each page's header JSX is replaced with a `<PageBanner ...>` call. `AddDeviceSection` is rewritten to open the modal containing `EnrollFlowCard`.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, `@chakra-ui/modal` (already in deps), `react-icons/md`, `next-intl`.

**Spec:** [docs/superpowers/specs/2026-05-18-page-header-banner-unification-design.md](../specs/2026-05-18-page-header-banner-unification-design.md)

**Verification model:** This codebase has no React component test harness — `vitest.config.ts` uses `environment: "node"` and only includes `tests/**/*.test.ts` against server/CLI/parser code. Standing up a React testing setup is out of scope. Each task is verified via `npm run verify` (prisma generate + `tsc --noEmit`) and committed; the final task is a manual visual smoke test in the dev server.

---

## File Map

**New files:**
- `app/_components/page-banner.tsx` — shared header banner component (~30 lines, server-component compatible, no `"use client"`)
- `src/components/modal/index.tsx` — Chakra modal wrapper (~30 lines, `"use client"`)

**Modified files:**
- `app/page.tsx` — replace existing inline banner block with `<PageBanner>`
- `app/devices/page.tsx` — replace bare H2 header with `<PageBanner>`
- `app/events/page.tsx` — replace bare H2 header with `<PageBanner>`
- `app/projects/[id]/page.tsx` — replace bare H2 header with `<PageBanner>`, back-link goes in `overline`
- `app/devices/[id]/page.tsx` — replace bare H2 header with `<PageBanner>`, back-link goes in `overline`, status badge and meta row migrate into `title` / `subtitle`
- `app/_components/add-device-section.tsx` — full rewrite: button + modal containing `EnrollFlowCard`

**Unchanged but verified for impact:**
- `app/_components/onboarding-card.tsx` — uses `EnrollFlowCard` directly, NOT via `AddDeviceSection`, so the modal refactor does not change the empty-state UI.

---

## Task 1: Create `PageBanner` component

**Files:**
- Create: `app/_components/page-banner.tsx`

- [ ] **Step 1: Create the component file**

Write `app/_components/page-banner.tsx` with this exact content:

```tsx
import type { ReactNode } from "react";

// Shared header banner used across dashboard pages. Mirrors the visual
// pattern that's been on the home page — a gradient-bordered card with
// two decorative blur orbs — so every page's first row stands clearly
// apart from the translucent sticky navbar above it.
//
// Pure-presentation. No state, no client hooks → safe to render from
// server components.
export function PageBanner({
  title,
  subtitle,
  note,
  overline,
  rightSlot,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  note?: ReactNode;
  overline?: ReactNode;
  rightSlot?: ReactNode;
}) {
  return (
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
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run verify`
Expected: `prisma generate` completes, then `tsc --noEmit` exits 0 with no errors.

- [ ] **Step 3: Commit**

```bash
git add app/_components/page-banner.tsx
git commit -m "feat(ui): add PageBanner component for unified page headers"
```

---

## Task 2: Create `Modal` wrapper component

**Files:**
- Create: `src/components/modal/index.tsx`

- [ ] **Step 1: Create the wrapper file**

Write `src/components/modal/index.tsx` with this exact content:

```tsx
"use client";

import type { ReactNode } from "react";
import { Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton } from "@chakra-ui/modal";

// Tailwind-skinned wrapper around Chakra's Modal — same pattern as
// src/components/popover/index.tsx and src/components/tooltip/index.tsx.
// The `!` modifier on Tailwind classes is necessary because Chakra ships
// inline styles whose specificity beats plain class rules.
export default function ModalDialog({
  isOpen,
  onClose,
  title,
  size = "lg",
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  children: ReactNode;
}) {
  return (
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
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run verify`
Expected: zero errors. If TypeScript complains that `@chakra-ui/modal` has no exported member, double-check the package is installed: `ls node_modules/@chakra-ui/modal` — it should exist per `package.json`.

- [ ] **Step 3: Commit**

```bash
git add src/components/modal/index.tsx
git commit -m "feat(ui): add Modal wrapper around @chakra-ui/modal"
```

---

## Task 3: Migrate home page (`app/page.tsx`) to `PageBanner`

**Files:**
- Modify: `app/page.tsx:97-117` (the existing HEADER BANNER block), add import

- [ ] **Step 1: Add import**

In `app/page.tsx`, locate the import block (lines 1-37). Add this line near the other `_components` imports (alphabetical order around line 30 is fine):

```tsx
import { PageBanner } from "./_components/page-banner";
```

- [ ] **Step 2: Replace the banner JSX**

In `app/page.tsx`, find this block (currently around lines 97-117):

```tsx
      {/* HEADER BANNER — subtle brand-purple gradient with decorative bloom
          for a touch of identity without becoming gaudy. */}
      <div className="relative overflow-hidden rounded-3xl border border-gray-200 bg-gradient-to-br from-brand-500/10 via-white to-brand-500/5 px-6 py-5 dark:border-white/10 dark:from-brand-500/15 dark:via-navy-800 dark:to-brand-500/5">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-12 h-48 w-48 rounded-full bg-brand-500/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-navy-700 dark:text-white">{t("home.title")}</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t("timezone.note")}</p>
          </div>
          <RangeSelector
            current={range}
            searchParams={params}
            labels={{
              sevenDay: t("home.range.sevenDay"),
              thirtyDay: t("home.range.thirtyDay"),
              all: t("home.range.all")
            }}
          />
        </div>
      </div>
```

Replace it with:

```tsx
      <PageBanner
        title={t("home.title")}
        note={<p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t("timezone.note")}</p>}
        rightSlot={
          <RangeSelector
            current={range}
            searchParams={params}
            labels={{
              sevenDay: t("home.range.sevenDay"),
              thirtyDay: t("home.range.thirtyDay"),
              all: t("home.range.all")
            }}
          />
        }
      />
```

- [ ] **Step 3: Run typecheck**

Run: `npm run verify`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "refactor(home): use shared PageBanner for header"
```

---

## Task 4: Migrate `/devices` (`app/devices/page.tsx`) to `PageBanner`

**Files:**
- Modify: `app/devices/page.tsx:74-94` (the bare H2 header block), add import

- [ ] **Step 1: Add import**

In `app/devices/page.tsx`, add to the import block (alongside the existing `../_components/add-device-section` import):

```tsx
import { PageBanner } from "../_components/page-banner";
```

- [ ] **Step 2: Replace the header block**

In `app/devices/page.tsx`, find this block (currently lines 76-94):

```tsx
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-navy-700 dark:text-white">{t("devices.title")}</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t("devices.subtitle")}</p>
          <p className="mt-0.5 text-xs text-gray-500">{t("timezone.note")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <AddDeviceSection initialDeviceIds={currentDevices.map((d) => d.deviceId)} />
          <DevicesRangeSelector
            current={range}
            searchParams={params}
            labels={{
              sevenDay: t("home.range.sevenDay"),
              thirtyDay: t("home.range.thirtyDay"),
              all: t("home.range.all")
            }}
          />
        </div>
      </div>
```

Replace it with:

```tsx
      <PageBanner
        title={t("devices.title")}
        subtitle={<p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t("devices.subtitle")}</p>}
        note={<p className="mt-0.5 text-xs text-gray-500">{t("timezone.note")}</p>}
        rightSlot={
          <div className="flex flex-wrap items-center gap-3">
            <AddDeviceSection initialDeviceIds={currentDevices.map((d) => d.deviceId)} />
            <DevicesRangeSelector
              current={range}
              searchParams={params}
              labels={{
                sevenDay: t("home.range.sevenDay"),
                thirtyDay: t("home.range.thirtyDay"),
                all: t("home.range.all")
              }}
            />
          </div>
        }
      />
```

- [ ] **Step 3: Run typecheck**

Run: `npm run verify`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add app/devices/page.tsx
git commit -m "refactor(devices): use shared PageBanner for header"
```

---

## Task 5: Migrate `/events` (`app/events/page.tsx`) to `PageBanner`

**Files:**
- Modify: `app/events/page.tsx:30-34` (the bare H2 header block), add import

- [ ] **Step 1: Add import**

In `app/events/page.tsx`, add to the import block:

```tsx
import { PageBanner } from "../_components/page-banner";
```

- [ ] **Step 2: Replace the header block**

In `app/events/page.tsx`, find this block (currently lines 30-34):

```tsx
      <div>
        <h2 className="text-2xl font-bold text-navy-700 dark:text-white">{t("events.title")}</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t("events.subtitle", { count: events.length })}</p>
        <p className="mt-0.5 text-xs text-gray-500">{t("timezone.note")}</p>
      </div>
```

Replace it with:

```tsx
      <PageBanner
        title={t("events.title")}
        subtitle={<p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t("events.subtitle", { count: events.length })}</p>}
        note={<p className="mt-0.5 text-xs text-gray-500">{t("timezone.note")}</p>}
      />
```

- [ ] **Step 3: Run typecheck**

Run: `npm run verify`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add app/events/page.tsx
git commit -m "refactor(events): use shared PageBanner for header"
```

---

## Task 6: Migrate `/projects/[id]` (`app/projects/[id]/page.tsx`) to `PageBanner`

**Files:**
- Modify: `app/projects/[id]/page.tsx:49-61` (the bare H2 header block), add import

- [ ] **Step 1: Add import**

In `app/projects/[id]/page.tsx`, add to the import block (alongside the existing `../../_components/project-icon` and `../../_components/source-pill` imports):

```tsx
import { PageBanner } from "../../_components/page-banner";
```

- [ ] **Step 2: Replace the header block**

In `app/projects/[id]/page.tsx`, find this block (currently lines 49-61):

```tsx
      <div>
        <Link href="/" className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:underline">
          <MdArrowBack className="h-4 w-4" />
          {t("project.back")}
        </Link>
        <div className="mt-2 flex items-center gap-2">
          <h2 className="text-2xl font-bold text-navy-700 dark:text-white">{project.name}</h2>
          <ProjectIcon repoKey={project.repoKey} workspacePath={project.workspacePath} size="md" folderTitle={t("project.localFolderTooltip")} />
        </div>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{project.workspacePath ?? t("project.noWorkspace")}</p>
        <p className="mt-0.5 text-xs text-gray-500">{t("project.aggregateNote")}</p>
        <p className="mt-0.5 text-xs text-gray-500">{t("timezone.note")}</p>
      </div>
```

Replace it with:

```tsx
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

Note: the "project not found" early-return branch (currently lines 27-39) is unchanged.

- [ ] **Step 3: Run typecheck**

Run: `npm run verify`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add app/projects/[id]/page.tsx
git commit -m "refactor(projects): use shared PageBanner for header"
```

---

## Task 7: Migrate `/devices/[id]` (`app/devices/[id]/page.tsx`) to `PageBanner`

**Files:**
- Modify: `app/devices/[id]/page.tsx:113-141` (the main header block), add import

- [ ] **Step 1: Add import**

In `app/devices/[id]/page.tsx`, add to the import block:

```tsx
import { PageBanner } from "../../_components/page-banner";
```

- [ ] **Step 2: Replace the header block**

In `app/devices/[id]/page.tsx`, find this block (currently lines 114-141):

```tsx
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/devices" className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:underline">
            <MdArrowBack className="h-4 w-4" />
            {t("device.back")}
          </Link>
          <div className="mt-2 flex items-center gap-2">
            <MdComputer className="h-6 w-6 text-brand-500" />
            <h2 className="text-2xl font-bold text-navy-700 dark:text-white">{device.name}</h2>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>{t(`clientStatus.${statusKey}`)}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
            <span>{t("device.meta.hostname", { value: device.hostname ?? "—" })}</span>
            <span>{t("device.meta.platform", { value: device.platform ?? "—" })}</span>
            <span>{t("device.meta.lastSeen", { value: formatRelativeTime(device.lastSeenAt?.toISOString() ?? null, tRelative) })}</span>
            <span>{t("device.meta.lastSync", { value: formatRelativeTime(device.lastSyncAt?.toISOString() ?? null, tRelative) })}</span>
          </div>
        </div>
        <DeviceRangeSelector
          deviceId={id}
          current={range}
          labels={{
            sevenDay: t("home.range.sevenDay"),
            thirtyDay: t("home.range.thirtyDay"),
            all: t("home.range.all")
          }}
        />
      </div>
```

Replace it with:

```tsx
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
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>{t(`clientStatus.${statusKey}`)}</span>
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
            labels={{
              sevenDay: t("home.range.sevenDay"),
              thirtyDay: t("home.range.thirtyDay"),
              all: t("home.range.all")
            }}
          />
        }
      />
```

Note: the "device not found" early-return branch (currently lines 94-106) is unchanged.

- [ ] **Step 3: Run typecheck**

Run: `npm run verify`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add app/devices/[id]/page.tsx
git commit -m "refactor(devices/detail): use shared PageBanner for header"
```

---

## Task 8: Convert `AddDeviceSection` into modal trigger

**Files:**
- Modify (full rewrite): `app/_components/add-device-section.tsx`

- [ ] **Step 1: Rewrite the file**

Open `app/_components/add-device-section.tsx` and replace its entire contents with:

```tsx
"use client";

import { useState } from "react";
import { MdAdd } from "react-icons/md";
import Modal from "@/components/modal";
import { EnrollFlowCard } from "./enroll-flow-card";

// Button on the /devices page header that opens a modal containing the
// enrollment flow. Replaces the previous inline-expanding card so the
// flow doesn't push the device table down the page.
//
// EnrollFlowCard is only mounted while the modal is open — closing the
// modal unmounts it, which cancels any in-flight polling (the component
// uses `setInterval` internally; React cleans it up on unmount).
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

- [ ] **Step 2: Run typecheck**

Run: `npm run verify`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add app/_components/add-device-section.tsx
git commit -m "refactor(devices): show add-device flow in a modal"
```

---

## Task 9: Manual visual smoke test

**Files:** none modified

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: Next.js dev server starts, prints local URL (typically `http://localhost:3000`).

- [ ] **Step 2: Verify each page in both color modes**

For each of these pages, open it in a browser, then toggle dark mode via the moon/sun button in the navbar, and confirm the banner looks consistent and the title is NOT crowded by the navbar:

1. `/` (home)
2. `/devices`
3. `/events`
4. `/projects/<any-project-id>` — pick an id from `/` projects ranking
5. `/devices/<any-device-id>` — pick an id from `/devices` table

For each page check:
- Banner gradient and blur orbs render visibly.
- Title is fully readable, not visually overlapped by the navbar's translucent strip.
- Right-side controls (RangeSelector, AddDeviceSection on /devices) align on the right edge of the banner without breaking layout.
- On `/projects/[id]` and `/devices/[id]`: back-link appears above the title.
- On `/devices/[id]`: device status pill stays inline with the title; the 4-field meta row sits below as subtitle.

- [ ] **Step 3: Verify the add-device modal**

On `/devices`:

1. Click "添加设备" → confirm modal opens centered with a dimmed/blurred overlay.
2. Press ESC → modal closes.
3. Re-open the modal, click outside (on the overlay) → modal closes.
4. Re-open the modal, click "生成命令" inside the modal, wait until the install command appears and the component enters polling mode (visible "waiting" UI).
5. Open DevTools → Network tab, filter for `/api/devices`. While polling is active, requests should appear every ~3s.
6. Close the modal (X button or ESC). Confirm in DevTools that no further `/api/devices` polling requests fire after a few seconds.
7. Re-open the modal — confirm it shows the initial idle state, not the previous command.

- [ ] **Step 4: Verify the empty-state path is unaffected**

If you have a tenant account with zero usage events, log in as that user and visit `/`. Confirm the onboarding card (which uses `EnrollFlowCard` directly, NOT `AddDeviceSection`) still renders inline as before — NO modal opens automatically and NO regression on the empty state.

If you don't have an empty-state tenant available, this can be verified by reading `app/_components/onboarding-card.tsx` and confirming it still imports `EnrollFlowCard` directly and is unchanged.

- [ ] **Step 5: Stop the dev server**

Press `Ctrl+C` in the terminal running `npm run dev`.

- [ ] **Step 6: Final commit (only if any tweaks were made during smoke testing)**

If smoke testing surfaced no issues: nothing to commit, you're done. The previous 8 commits cover the work.

If smoke testing surfaced a visual regression that required a tweak, fix it, then:

```bash
git add <touched-files>
git commit -m "fix(ui): <describe the tweak>"
```

---

## Summary of Commits

After completing all tasks, the branch should contain these commits (one per task that touches code):

1. `feat(ui): add PageBanner component for unified page headers`
2. `feat(ui): add Modal wrapper around @chakra-ui/modal`
3. `refactor(home): use shared PageBanner for header`
4. `refactor(devices): use shared PageBanner for header`
5. `refactor(events): use shared PageBanner for header`
6. `refactor(projects): use shared PageBanner for header`
7. `refactor(devices/detail): use shared PageBanner for header`
8. `refactor(devices): show add-device flow in a modal`
9. (Optional) `fix(ui): <tweak from smoke testing>`
