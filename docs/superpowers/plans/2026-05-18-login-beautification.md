# Login Page Beautification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain centered-card login screens with a full-page brand-gradient backdrop + glass-morphic card + Tokenizer wordmark, strip `AdminShell` from `/login` routes, and add submit pending state + 60s resend cooldown + animated email icon.

**Architecture:** Three new co-located components in `app/_components/` — a server-rendered `LoginShell` (gradient field + bloom orbs + wordmark), and two client components (`LoginSubmitButton` using React 19 `useFormStatus`, `LoginResendCountdown` with a 60s timer). Both login pages consume them. `AdminShell` gets a 3-line route check to bypass its sidebar/navbar for `/login*`. Two i18n message files gain a new top-level `login` namespace.

**Tech Stack:** Next.js 15 App Router (server actions), React 19 (`useFormStatus`), TypeScript, Tailwind CSS, `next-intl`, `react-icons/md`.

**Spec:** [docs/superpowers/specs/2026-05-18-login-beautification-design.md](../specs/2026-05-18-login-beautification-design.md)

**Verification model:** This codebase has no React component test harness — `vitest.config.ts` uses `environment: "node"` and only includes `tests/**/*.test.ts` against server/CLI/parser code. Each task is verified via `npm run verify` (prisma generate + `tsc --noEmit`) and committed. Final task is a manual visual smoke test in the dev server, handed off to the user.

**Ordering rationale:** AdminShell gate goes first so intermediate commits leave `/login` looking unfinished but coherent (plain card on flat bg, no broken sidebar overlay). The reverse order would leave a half-migrated state where the new gradient + glass card collides with the still-present sidebar.

**Git identity for commits:** Use `git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit ...` on every commit. Do NOT run `git config`.

---

## File Map

**New files:**
- `app/_components/login-shell.tsx` — gradient backdrop + bloom orbs + wordmark wrapper (server component, ~32 lines)
- `app/_components/login-submit-button.tsx` — pending-aware submit button (client component, ~36 lines)
- `app/_components/login-resend-countdown.tsx` — 60s cooldown then resend link (client component, ~26 lines)

**Modified files:**
- `app/admin-shell.tsx` — 4-line route gate that bypasses the shell for `/login*`
- `app/login/page.tsx` — use `LoginShell` + `LoginSubmitButton`, glass card styling, i18n
- `app/login/verify/page.tsx` — use `LoginShell` + `LoginResendCountdown`, animated icon, i18n
- `messages/zh-CN.json` — add top-level `login` namespace
- `messages/en.json` — add top-level `login` namespace

**Important context for the engineer:**
- The existing `"admin": { "login": {...} }` block in both message files is **a different login flow** (admin setup-token login at `/admin/login`). Do NOT modify it. Add a NEW top-level `"login": {...}` block alongside (sibling of `admin`, `footer`, `home`, etc.).
- `usePathname` is already imported at line 3 of `app/admin-shell.tsx` — no new import needed for Task 1.
- The home page banner pattern (`app/_components/page-banner.tsx`) and decorative bloom orb classes are the existing visual vocabulary. The new `LoginShell` is intentionally not built on `PageBanner` because a full-screen takeover has different constraints (4 orbs, `min-h-screen`, no border).

---

## Task 1: Add route gate to `AdminShell`

**Files:**
- Modify: `app/admin-shell.tsx:11-15` (inside the `AdminShell` function body)

- [ ] **Step 1: Read the current file to confirm import + insertion point**

Read `/mnt/c/Users/tripplezhou/project/tokenizer/app/admin-shell.tsx`. Confirm:
- Line 3 imports `usePathname` from `next/navigation`.
- Lines 11-15 contain the function start including the `const pathname = usePathname();` declaration on line 13 (or similar).

- [ ] **Step 2: Insert the route gate**

Modify `app/admin-shell.tsx`. After the existing line `if (isWindowAvailable()) document.documentElement.dir = "ltr";` (around line 14), insert the following block on a new line:

```tsx
  // Login routes render full-bleed with their own brand shell — bypass
  // the admin sidebar/navbar so unauthenticated users don't see nav
  // links they can't use.
  if (pathname?.startsWith("/login")) return <>{children}</>;
```

The function body should now look like:

```tsx
export function AdminShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  if (isWindowAvailable()) document.documentElement.dir = "ltr";

  // Login routes render full-bleed with their own brand shell — bypass
  // the admin sidebar/navbar so unauthenticated users don't see nav
  // links they can't use.
  if (pathname?.startsWith("/login")) return <>{children}</>;

  return (
    <div className="flex h-full w-full bg-background-100 dark:bg-background-900">
      ...
```

Do not modify anything else.

- [ ] **Step 3: Run typecheck**

Run: `npm run verify`
Expected: prisma generate succeeds, `tsc --noEmit` exits 0 with no errors.

- [ ] **Step 4: Commit**

```bash
git add app/admin-shell.tsx
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(login): bypass AdminShell on /login routes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Add `login` namespace to i18n files

**Files:**
- Modify: `messages/zh-CN.json` — insert new `"login"` block before the existing `"admin"` key (around line 248)
- Modify: `messages/en.json` — insert new `"login"` block before the existing `"admin"` key (around line 248)

- [ ] **Step 1: Confirm insertion point in both files**

Read `/mnt/c/Users/tripplezhou/project/tokenizer/messages/zh-CN.json` around line 245-250. You should see the closing `}` of the `"home"` block followed by `"admin": { "login": { ... } }`. The new top-level `"login"` block goes BETWEEN these — sibling of `"admin"`, NOT inside it.

Read `/mnt/c/Users/tripplezhou/project/tokenizer/messages/en.json` around line 245-250 — same structure.

- [ ] **Step 2: Insert into `messages/zh-CN.json`**

In `messages/zh-CN.json`, find the line `  "admin": {` (around line 248). Immediately BEFORE that line, insert:

```json
  "login": {
    "tagline": "编程 token 用量追踪",
    "title": "登录 Tokenizer",
    "description": "填写邮箱，我们会发送一封登录链接邮件到你的邮箱，点击链接即可登录，无需密码。",
    "field": {
      "email": "邮箱"
    },
    "submit": {
      "idle": "发送登录链接",
      "pending": "发送中…"
    },
    "firstUseHint": "首次使用？填写邮箱后会自动创建账号。",
    "error": {
      "configuration": "登录服务暂未配置完成，请稍后再试或联系管理员。",
      "generic": "登录失败（{code}）。"
    },
    "verify": {
      "title": "查收你的邮箱",
      "description": "登录链接已发送。点击邮件里的链接即可登录；链接 10 分钟内有效。",
      "noEmailHint": "没收到？检查垃圾邮件文件夹，或 ",
      "resendWaiting": "{seconds}s 后可重发",
      "resendReady": "重新发送"
    }
  },
```

Note the trailing comma — the next sibling `"admin"` continues after this block.

- [ ] **Step 3: Insert into `messages/en.json`**

In `messages/en.json`, find the line `  "admin": {` (around line 248). Immediately BEFORE that line, insert:

```json
  "login": {
    "tagline": "Coding token usage tracker",
    "title": "Sign in to Tokenizer",
    "description": "Enter your email; we'll send you a one-click sign-in link. No password needed.",
    "field": {
      "email": "Email"
    },
    "submit": {
      "idle": "Send sign-in link",
      "pending": "Sending…"
    },
    "firstUseHint": "First time? An account is created automatically when you submit.",
    "error": {
      "configuration": "Sign-in service is not configured yet. Try again later or contact the admin.",
      "generic": "Sign-in failed ({code})."
    },
    "verify": {
      "title": "Check your inbox",
      "description": "We sent you a sign-in link. Click it to finish signing in — valid for 10 minutes.",
      "noEmailHint": "Didn't get it? Check your spam folder, or ",
      "resendWaiting": "Resend in {seconds}s",
      "resendReady": "Resend now"
    }
  },
```

- [ ] **Step 4: Validate JSON syntax**

Run: `node -e "JSON.parse(require('fs').readFileSync('messages/zh-CN.json','utf8'))" && node -e "JSON.parse(require('fs').readFileSync('messages/en.json','utf8'))" && echo OK`
Expected: prints `OK`. If you see a SyntaxError, you have a comma / bracket issue — fix it.

- [ ] **Step 5: Run typecheck**

Run: `npm run verify`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add messages/zh-CN.json messages/en.json
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(i18n): add login namespace for beautified pages

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Create `LoginShell` component

**Files:**
- Create: `app/_components/login-shell.tsx`

- [ ] **Step 1: Create the file**

Write `app/_components/login-shell.tsx` with this exact content:

```tsx
import type { ReactNode } from "react";
import { MdBolt } from "react-icons/md";

// Full-screen brand backdrop for /login and /login/verify. Renders the
// gradient field, four bloom orbs, and the Tokenizer wordmark above the
// children slot. Pure presentation; server-component compatible.
//
// Four orbs (vs. two on the home page banner) because the canvas is the
// whole viewport and two would leave large dead zones.
export function LoginShell({
  tagline,
  children,
}: {
  tagline: string;
  children: ReactNode;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-brand-500/15 via-white to-brand-500/5 dark:from-brand-500/20 dark:via-navy-900 dark:to-brand-500/10">
      <div className="pointer-events-none absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-brand-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 -bottom-32 h-[26rem] w-[26rem] rounded-full bg-brand-500/15 blur-3xl" />
      <div className="pointer-events-none absolute right-1/4 -top-24 h-72 w-72 rounded-full bg-brand-300/20 blur-3xl" />
      <div className="pointer-events-none absolute left-1/4 -bottom-24 h-64 w-64 rounded-full bg-brand-300/15 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 py-12">
        <div className="mb-3 flex items-center gap-2.5">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-500 text-white shadow-lg shadow-brand-500/30">
            <MdBolt className="h-6 w-6" />
          </span>
          <span className="font-poppins text-2xl font-bold tracking-tight text-navy-700 dark:text-white">
            Tokenizer
          </span>
        </div>
        <p className="mb-8 text-center text-sm text-gray-600 dark:text-gray-400">{tagline}</p>

        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run verify`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add app/_components/login-shell.tsx
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(login): add LoginShell with gradient backdrop + wordmark

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Create `LoginSubmitButton` component

**Files:**
- Create: `app/_components/login-submit-button.tsx`

- [ ] **Step 1: Create the file**

Write `app/_components/login-submit-button.tsx` with this exact content:

```tsx
"use client";

import { useFormStatus } from "react-dom";
import { MdMailOutline } from "react-icons/md";

// Submit button that reads pending state from the nearest ancestor
// <form> via React 19's useFormStatus(). Lets the form stay
// server-rendered while still giving the user a disabled/spinner state
// during the in-flight server action. Must be imported from react-dom,
// not react.
export function LoginSubmitButton({
  idleLabel,
  pendingLabel,
}: {
  idleLabel: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-3 py-2 text-sm font-medium text-white shadow-sm shadow-brand-500/30 transition hover:bg-brand-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-brand-500 disabled:active:scale-100"
    >
      {pending ? <Spinner /> : <MdMailOutline className="h-4 w-4" />}
      <span>{pending ? pendingLabel : idleLabel}</span>
    </button>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run verify`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add app/_components/login-submit-button.tsx
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(login): add LoginSubmitButton with useFormStatus pending state

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Create `LoginResendCountdown` component

**Files:**
- Create: `app/_components/login-resend-countdown.tsx`

- [ ] **Step 1: Create the file**

Write `app/_components/login-resend-countdown.tsx` with this exact content:

```tsx
"use client";

import { useEffect, useState } from "react";

// Mounts → starts a countdown from `seconds` → renders a muted waiting
// message → at 0 swaps to a clickable resend link pointing back to
// /login (where the user re-enters their email). Resets on every mount
// (page refresh restarts the timer — intentional, no persistence).
//
// `waitingLabel` must contain the literal "{seconds}" placeholder.
export function LoginResendCountdown({
  seconds,
  waitingLabel,
  readyLabel,
}: {
  seconds: number;
  waitingLabel: string;
  readyLabel: string;
}) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(id);
  }, [remaining]);

  if (remaining > 0) {
    return (
      <span className="text-gray-400 dark:text-gray-500">
        {waitingLabel.replace("{seconds}", String(remaining))}
      </span>
    );
  }
  return (
    <a className="font-medium text-brand-500 hover:underline" href="/login">
      {readyLabel}
    </a>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run verify`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add app/_components/login-resend-countdown.tsx
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(login): add LoginResendCountdown with 60s cooldown

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Migrate `/login` to new shell + submit button

**Files:**
- Modify (full rewrite): `app/login/page.tsx`

- [ ] **Step 1: Rewrite the file**

Replace the entire contents of `app/login/page.tsx` with:

```tsx
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth, signIn } from "@/auth";
import { LoginShell } from "../_components/login-shell";
import { LoginSubmitButton } from "../_components/login-submit-button";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; callbackUrl?: string }> }) {
  const params = await searchParams;
  const session = await auth();
  if (session?.user) redirect(params.callbackUrl ?? "/");
  const t = await getTranslations();

  // Server action — when AUTH_RESEND_KEY isn't configured, the "resend"
  // provider isn't registered, signIn() throws, and we redirect back here
  // with ?error=Configuration so the user sees a useful message.
  async function loginAction(formData: FormData) {
    "use server";
    const email = formData.get("email");
    if (typeof email !== "string" || !email) return;
    await signIn("resend", { email, redirectTo: "/" });
  }

  return (
    <LoginShell tagline={t("login.tagline")}>
      <div className="w-full rounded-2xl border border-white/40 bg-white/70 p-8 shadow-xl shadow-brand-500/5 backdrop-blur-xl dark:border-white/10 dark:bg-navy-800/70">
        <h1 className="text-2xl font-bold text-navy-700 dark:text-white">{t("login.title")}</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{t("login.description")}</p>

        {params.error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50/80 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {params.error === "Configuration"
              ? t("login.error.configuration")
              : t("login.error.generic", { code: params.error })}
          </div>
        ) : null}

        <form action={loginAction} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t("login.field.email")}
            </label>
            <input
              id="email"
              type="email"
              name="email"
              required
              autoComplete="email"
              className="mt-1 block w-full rounded-xl border border-gray-300 bg-white/80 px-3 py-2 text-sm text-navy-700 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-white/10 dark:bg-navy-900/60 dark:text-white"
              placeholder="you@example.com"
            />
          </div>
          <LoginSubmitButton idleLabel={t("login.submit.idle")} pendingLabel={t("login.submit.pending")} />
        </form>

        <p className="mt-6 text-center text-xs text-gray-500 dark:text-gray-400">
          {t("login.firstUseHint")}
        </p>
      </div>
    </LoginShell>
  );
}
```

Notes:
- The previous file imported `Card` from `@/components/card` — this import is now GONE (replaced by inline glass-card div).
- The `loginAction` server action is unchanged in behavior, just kept inside the new structure.

- [ ] **Step 2: Run typecheck**

Run: `npm run verify`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add app/login/page.tsx
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(login): migrate /login to brand shell + pending submit

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Migrate `/login/verify` to new shell + countdown + animated icon

**Files:**
- Modify (full rewrite): `app/login/verify/page.tsx`

- [ ] **Step 1: Rewrite the file**

Replace the entire contents of `app/login/verify/page.tsx` with:

```tsx
import { MdMarkEmailRead } from "react-icons/md";
import { getTranslations } from "next-intl/server";
import { LoginShell } from "../../_components/login-shell";
import { LoginResendCountdown } from "../../_components/login-resend-countdown";

export const dynamic = "force-dynamic";

export default async function VerifyPage() {
  const t = await getTranslations();
  return (
    <LoginShell tagline={t("login.tagline")}>
      <div className="w-full rounded-2xl border border-white/40 bg-white/70 p-8 text-center shadow-xl shadow-brand-500/5 backdrop-blur-xl dark:border-white/10 dark:bg-navy-800/70">
        {/* Animated email icon — outer ping ring + slower inner pulse +
            steady icon, reads as "actively waiting for email." */}
        <div className="relative mx-auto h-16 w-16">
          <span className="absolute inset-0 animate-ping rounded-full bg-brand-500/20" />
          <span className="absolute inset-0 animate-pulse rounded-full bg-brand-500/10" />
          <span className="relative inline-flex h-16 w-16 items-center justify-center rounded-full bg-brand-500/15 text-brand-500">
            <MdMarkEmailRead className="h-7 w-7" />
          </span>
        </div>

        <h1 className="mt-5 text-2xl font-bold text-navy-700 dark:text-white">{t("login.verify.title")}</h1>
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">{t("login.verify.description")}</p>

        <div className="mt-6 text-xs text-gray-500 dark:text-gray-400">
          {t("login.verify.noEmailHint")}
          <LoginResendCountdown
            seconds={60}
            waitingLabel={t("login.verify.resendWaiting")}
            readyLabel={t("login.verify.resendReady")}
          />
        </div>
      </div>
    </LoginShell>
  );
}
```

Notes:
- The previous file imported `Card` — that import is GONE.
- Page is now `async` (was sync) because `getTranslations()` is awaited.

- [ ] **Step 2: Run typecheck**

Run: `npm run verify`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add app/login/verify/page.tsx
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "feat(login): migrate /login/verify to brand shell + animated icon + cooldown

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Manual visual smoke test

**Files:** none modified

This task is handed off to the user — subagents cannot perform visual checks in a browser. After Task 7, all code changes are complete; the engineer (or the dispatching controller) should hand the branch to the user for this verification.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: Next.js dev server starts, prints local URL (typically `http://localhost:3000`).

- [ ] **Step 2: Verify `/login` in both color modes**

Open `http://localhost:3000/login` in a browser. Confirm:
- Full-page brand-purple gradient backdrop with 4 visible bloom orbs at the corners (2 strong + 2 soft).
- Tokenizer wordmark with bolt icon centered above the form card.
- "编程 token 用量追踪" tagline below the wordmark.
- Glass-morphic card visible: `bg-white/70` with `backdrop-blur` (background gradient shows through softly).
- Email input has subtle brand-purple focus ring when focused.
- **No sidebar, no navbar.**

Toggle dark mode (via the moon/sun button in the original navbar — note: that toggle lives in the navbar which is now hidden on `/login`; toggle from another page first, then return to `/login`). Confirm dark variant renders with `dark:bg-navy-800/70` glass card and deeper gradient.

- [ ] **Step 3: Verify the submit button pending state**

On `/login`, enter a valid-looking email and click "发送登录链接".
- Confirm: button immediately becomes disabled (faded, no hover).
- Spinner appears in place of the mail icon.
- Label changes to "发送中…".
- Page eventually navigates to `/login/verify`.

If `AUTH_RESEND_KEY` is not configured locally, the server action will throw and you'll land back on `/login?error=Configuration` — verify the red banner renders with glass-friendly styling.

- [ ] **Step 4: Verify `/login/verify`**

On `/login/verify`, confirm:
- Same brand backdrop + wordmark above a glass card.
- Email icon has **two visible animations**: an outer ring expanding outward (`animate-ping`) and an inner halo pulsing (`animate-pulse`).
- "查收你的邮箱" headline.
- Countdown text reads "60s 后可重发" and ticks down by 1 every second.
- After ~60 seconds, the countdown becomes the brand-500 link "重新发送".
- Click the resend link → navigates to `/login` in idle state.

- [ ] **Step 5: Verify no regression on authenticated access**

Sign in normally (use a real email if the magic-link path works), then visit `http://localhost:3000/login` directly. Confirm: you are redirected to `/` (or `callbackUrl` if set) — no login form rendered.

- [ ] **Step 6: Verify English locale**

Switch the browser language to English (or visit any page with `?locale=en` if the route supports it) and revisit `/login` and `/login/verify`. Confirm all new strings render in English ("Sign in to Tokenizer", "Send sign-in link", "Check your inbox", "Resend in {n}s", etc.) — no key fallback like "login.title" visible.

- [ ] **Step 7: Stop the dev server**

Press `Ctrl+C` in the terminal running `npm run dev`.

- [ ] **Step 8: (Only if smoke testing surfaced a fix)**

If everything passed: nothing to commit; the previous 7 commits cover the work.

If smoke testing surfaced a visual regression that required a tweak, fix it locally, then:

```bash
git add <touched-files>
git -c user.name='tripplezhou' -c user.email='tripplezhou@gmail.com' commit -m "fix(login): <describe the tweak>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Summary of Commits

After Task 7 completes, the branch should contain these commits:

1. `feat(login): bypass AdminShell on /login routes`
2. `feat(i18n): add login namespace for beautified pages`
3. `feat(login): add LoginShell with gradient backdrop + wordmark`
4. `feat(login): add LoginSubmitButton with useFormStatus pending state`
5. `feat(login): add LoginResendCountdown with 60s cooldown`
6. `feat(login): migrate /login to brand shell + pending submit`
7. `feat(login): migrate /login/verify to brand shell + animated icon + cooldown`
8. (Optional from Task 8) `fix(login): <tweak from smoke testing>`
