# Login Page Beautification

**Date:** 2026-05-18
**Status:** Approved (pending spec review)

## Problem

The current `/login` and `/login/verify` pages render as a plain centered
`<Card>` over a flat background — no brand identity, no atmosphere, no
visual continuity with the rest of the dashboard. Three concrete issues:

1. **AdminShell injection.** Both login pages get the sidebar + navbar
   from `AdminShell` because the root layout wraps every route in it.
   Unauthenticated users see nav links they can't use, which is
   confusing and visually noisy.
2. **No brand identity.** No logo, no gradient, no Tokenizer voice. The
   pages look like a default Tailwind starter and are visually
   disconnected from the home page's gradient banner.
3. **Missing interaction polish.** The submit button has no pending
   state, the verify page has no "wait before resending" affordance,
   and the verify page's email icon is static.

## Goals

- Strong first impression: full-page brand-gradient atmosphere with
  bloom orbs, Tokenizer wordmark above a glass-morphic card, visual
  language continuous with the home page banner.
- `/login` and `/login/verify` no longer render inside `AdminShell`.
- Three specific polish improvements:
  - Pending state on the "发送登录链接" button using React 19
    `useFormStatus()`.
  - 60-second resend cooldown on `/login/verify`.
  - Animated email icon (concentric `animate-ping` + `animate-pulse`
    rings) on `/login/verify`.

## Non-Goals

- Third-party OAuth (Google / GitHub / SSO).
- Mail-client quicklinks ("Open Gmail / Outlook") on the verify page.
- Resend cooldown persistence across page reload (intentional: keep it
  simple).
- Layout restructure (no split-pane, no full-screen hero floats — the
  centered card stays).
- `/admin/login` (separate admin setup-token flow; out of scope).
- Backend changes to next-auth / Resend provider.
- New brand assets (no logo SVG; the wordmark is type-set and the icon
  is `MdBolt` from `react-icons/md`).

## Architecture

### New files

#### `app/_components/login-shell.tsx` (server component)

Shared visual shell for both login pages. Renders:
- A full-screen gradient field (`from-brand-500/15 via-white to-brand-500/5`
  in light, deeper in dark mode).
- Four `pointer-events-none` blur orbs — two stronger (brand-500/20 and
  brand-500/15) at top-left and bottom-right, two softer (brand-300/20
  and brand-300/15) at the remaining corners. Four orbs (not two) because
  the canvas is full-screen and two leaves too much dead space.
- The "icon + Tokenizer" wordmark anchored above the slot:
  - Icon: `MdBolt` from `react-icons/md` in a 40×40 rounded square,
    `bg-brand-500 text-white`, with a `shadow-brand-500/30` glow.
  - Wordmark: `font-poppins text-2xl font-bold tracking-tight
    text-navy-700 dark:text-white`. The font and weight match
    `src/components/sidebar/index.tsx:24`, preserving brand continuity
    once the user lands on the dashboard.
- A `tagline` paragraph below the wordmark.
- The `children` slot, centered vertically in the viewport via
  `min-h-screen flex flex-col items-center justify-center`.

Props:

| Prop      | Type        | Notes                                      |
|-----------|-------------|--------------------------------------------|
| `tagline` | `string`    | Required. Localized tagline below wordmark.|
| `children`| `ReactNode` | Page-specific card content.                |

#### `app/_components/login-submit-button.tsx` (client component)

Pending-aware submit button using React 19's `useFormStatus()`. Idle:
mail-outline icon + idle label. Pending: spinner + pending label,
`disabled`, slightly faded (`opacity-70`), no hover/active scale.

Why `useFormStatus()` (not local state): the parent `<form>` uses a
server action. `useFormStatus()` reads pending state from the nearest
ancestor form without lifting state up, so the `<form>` itself stays a
server-rendered element.

Props:

| Prop           | Type    | Notes                              |
|----------------|---------|------------------------------------|
| `idleLabel`    | `string`| Localized idle text.               |
| `pendingLabel` | `string`| Localized in-flight text.          |

Imported from `react-dom` (not `react`).

#### `app/_components/login-resend-countdown.tsx` (client component)

60-second countdown on `/login/verify` before the user can click
"resend." Mounts → starts countdown → shows muted "Resend in {n}s" text
→ when 0, becomes a clickable `<a href="/login">` styled as a brand-500
link.

Behavior: re-clicking "resend" navigates back to `/login`, where the
user re-enters their email and submits. We do NOT try to remember the
email or call signIn from the verify page — keep state minimal and
flow obvious.

Props:

| Prop           | Type    | Notes                                                    |
|----------------|---------|----------------------------------------------------------|
| `seconds`      | `number`| Starting countdown (60 for this design).                 |
| `waitingLabel` | `string`| Must contain literal `{seconds}` — replaced at render.   |
| `readyLabel`   | `string`| Localized resend-now label.                              |

`{seconds}` placeholder uses `String.replace` (not next-intl
interpolation) so the component is i18n-runtime independent.

### Modified files

#### `app/login/page.tsx`

- Wrap content in `<LoginShell tagline={t("login.tagline")}>`.
- Replace `<Card extra="p-8">` with a glass-morphic div:
  ```
  rounded-2xl border border-white/40 bg-white/70 p-8 shadow-xl
  shadow-brand-500/5 backdrop-blur-xl
  dark:border-white/10 dark:bg-navy-800/70
  ```
- Replace inline `<button>` with `<LoginSubmitButton idleLabel={t(...)}
  pendingLabel={t(...)} />`.
- Email input gets a `focus:ring-2 focus:ring-brand-500/20` and a
  semi-transparent surface (`bg-white/80` / `dark:bg-navy-900/60`) so it
  feels native to the glass card.
- Error condition unchanged in behavior; error banner gets `bg-red-50/80`
  for visual harmony with the glass card.
- All text moves to i18n keys (listed below).

The server action `loginAction` is unchanged.

#### `app/login/verify/page.tsx`

- Wrap in `<LoginShell>`.
- Glass-morphic card (same class string as `/login`).
- Replace the static brand-circle icon with a layered animation:
  ```
  <div className="relative mx-auto h-16 w-16">
    <span className="absolute inset-0 animate-ping rounded-full bg-brand-500/20" />
    <span className="absolute inset-0 animate-pulse rounded-full bg-brand-500/10" />
    <span className="relative inline-flex h-16 w-16 items-center justify-center rounded-full bg-brand-500/15 text-brand-500">
      <MdMarkEmailRead className="h-7 w-7" />
    </span>
  </div>
  ```
  Visually: a steady icon, a slow-pulsing inner halo, a faster outward
  ping ring — reads as "actively waiting for email."
- Replace the inline `<a href="/login">重新发送</a>` with
  `<LoginResendCountdown seconds={60} ... />`.
- All text moves to i18n keys.

#### `app/admin-shell.tsx`

Add 4 lines (including comment) at the top of `AdminShell()`:

```tsx
const pathname = usePathname();
if (isWindowAvailable()) document.documentElement.dir = "ltr";

// Login routes render full-bleed with their own brand shell — bypass
// the admin sidebar/navbar so unauthenticated users don't see nav
// links they can't use.
if (pathname?.startsWith("/login")) return <>{children}</>;
```

`usePathname` is already imported (line 3 of the file).

### Translation keys

Added to both `messages/zh-CN.json` and `messages/en.json` under a
`login` namespace:

| Key                                | zh-CN                                          | en                                          |
|------------------------------------|------------------------------------------------|---------------------------------------------|
| `login.tagline`                    | "编程 token 用量追踪"                          | "Coding token usage tracker"                |
| `login.title`                      | "登录 Tokenizer"                               | "Sign in to Tokenizer"                      |
| `login.description`                | "填写邮箱，我们会发送一封登录链接邮件到你的邮箱，点击链接即可登录，无需密码。" | "Enter your email; we'll send you a one-click sign-in link. No password needed." |
| `login.field.email`                | "邮箱"                                         | "Email"                                     |
| `login.submit.idle`                | "发送登录链接"                                 | "Send sign-in link"                         |
| `login.submit.pending`             | "发送中…"                                      | "Sending…"                                  |
| `login.firstUseHint`               | "首次使用？填写邮箱后会自动创建账号。"         | "First time? An account is created automatically when you submit." |
| `login.error.configuration`        | "登录服务暂未配置完成，请稍后再试或联系管理员。" | "Sign-in service is not configured yet. Try again later or contact the admin." |
| `login.error.generic`              | "登录失败（{code}）。"                         | "Sign-in failed ({code})."                  |
| `login.verify.title`               | "查收你的邮箱"                                 | "Check your inbox"                          |
| `login.verify.description`         | "登录链接已发送。点击邮件里的链接即可登录；链接 10 分钟内有效。" | "We sent you a sign-in link. Click it to finish signing in — valid for 10 minutes." |
| `login.verify.noEmailHint`         | "没收到？检查垃圾邮件文件夹，或 "              | "Didn't get it? Check your spam folder, or " |
| `login.verify.resendWaiting`       | "{seconds}s 后可重发"                          | "Resend in {seconds}s"                      |
| `login.verify.resendReady`         | "重新发送"                                     | "Resend now"                                |

## Edge Cases

- **Glass card readability over orbs:** `backdrop-blur-xl` plus 70%
  opacity surface keeps text contrast adequate against the gradient.
  Verified visually as part of the manual smoke test.
- **Small viewports:** orbs' negative-offset corners (`-left-32`, etc.)
  could overflow on narrow screens; `overflow-hidden` on the shell
  clips them safely.
- **JS disabled:** `useFormStatus()` no-ops; the button stays in its
  idle state but the form still POSTs to the server action (default
  browser form behavior). No regression vs. current.
- **Countdown reset on refresh:** intentional — refresh on
  `/login/verify` restarts the 60s window. Persisting via localStorage
  is YAGNI for this flow.
- **Resend re-enters via `/login`:** clicking "Resend now" navigates to
  `/login`; user re-enters email and re-submits. This produces a NEW
  one-time token (old token remains valid for its 10-minute window).
  Standard next-auth behavior; no backend change.
- **Already-authenticated user on `/login`:** existing redirect
  (`if (session?.user) redirect(callbackUrl ?? "/")`) preserved.
- **Error banner:** `?error=Configuration` still renders, just with
  glass-friendly styling.

## Testing

No React component test harness exists in this codebase. Verification:

1. `npm run verify` — prisma generate + `tsc --noEmit` exits 0.
2. `npm run dev` + manual browser smoke (light + dark mode):
   - `/login` renders the brand-gradient backdrop with 4 bloom orbs,
     wordmark + bolt icon above a glass card, tagline visible.
   - **No sidebar/navbar** on `/login` or `/login/verify`.
   - Submit "发送登录链接" → button disables, spinner appears, label
     becomes "发送中…", then redirects to `/login/verify`.
   - On `/login/verify`: email icon has visible double animation
     (inner pulse, outer ping). Countdown shows "60s 后可重发", ticks
     down, becomes clickable "重新发送" link at 0.
   - Clicking resend → `/login` (idle state).
   - Visit `/login?error=Configuration` → red configuration banner
     renders inside the glass card.
   - Visit `/login` while signed in → redirect to `/` (no regression).
3. Locale toggle: confirm new keys render in both `zh-CN` and `en`
   (e.g. via `?locale=en` if the route supports it, or browser
   language switch).

## Files Touched

**New:**
- `app/_components/login-shell.tsx`
- `app/_components/login-submit-button.tsx`
- `app/_components/login-resend-countdown.tsx`

**Modified:**
- `app/login/page.tsx`
- `app/login/verify/page.tsx`
- `app/admin-shell.tsx`
- `messages/zh-CN.json`
- `messages/en.json`

**Unchanged but verified for impact:**
- `app/layout.tsx` — root layout still wraps everything in AdminShell;
  the route check inside AdminShell handles the bypass.
- `src/auth.ts`, `src/server/auth.ts`, `src/server/auth-session.ts` —
  no backend changes.
- `app/admin/login/page.tsx` — admin setup-token login, separate flow,
  not touched.
