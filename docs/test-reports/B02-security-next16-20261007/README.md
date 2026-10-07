# B02 dependency migration round 2: Generator handoff

- Base candidate: `4b67b2ec33157b70149d708aebea21d3bd5dbbff` in a new detached worktree.
- Scope: remove B02's remaining production audit High/Moderate records through a supported Next 16 and next-intl 4 migration. This is a Generator candidate, not an Evaluator verdict or release approval.
- No original worktree, `progress.json`, gate, production, push or deployment was changed.

## Migration and compatibility

`next` and `eslint-config-next` are exactly `16.4.0`; `next-intl` is exactly `4.14.9`. Next 16's exact nested `postcss` is `8.5.23`. The compatible transitive `baseline-browser-mapping` lock entry was advanced to `2.11.27` because `2.10.29` introduced a new Moderate audit record after the initial upgrade. `eslint` is pinned at `9.39.5`: v16's config requires ESLint 9+, while its current `eslint-plugin-react` and `eslint-plugin-jsx-a11y` dependencies do not declare ESLint 10 support. npm warns that ESLint 9 is no longer supported; this is an explicit tooling follow-up, not a production audit exception.

The official [Next 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16) requires the ESLint CLI instead of removed `next lint`, async request APIs, and a second `revalidateTag` argument. Existing pages/routes already await `params`, `searchParams` and `cookies`, and this repository has no `middleware.ts`. `npm run lint` now runs flat-config ESLint with `--max-warnings=0`. The old `.eslintrc.json` was removed. Fifteen stale disable directives emitted by the new CLI were removed; no application logic changed in those files. Four newly enabled React Compiler diagnostics (`immutability`, `purity`, `set-state-in-effect`, `incompatible-library`) are disabled in `eslint.config.mjs` because the project does **not** enable `reactCompiler` and addressing existing components is separate work. Other Next, React Hooks and accessibility rules remain active. This restores the pre-upgrade lint baseline rather than silently ignoring warnings. Reassess those four rules before enabling React Compiler.

Pricing approval/automatic lookup still needs immediate invalidation rather than the Next 16 stale-while-revalidate `"max"` profile. Both `revalidateTag` calls use `{ expire: 0 }`, the supported two-argument immediate-expiry form. One pre-existing invalid CSS selector (`input.defaultCheckbox::before path`) had no valid DOM target and stopped Turbopack parsing; it was removed. Next 16 generated `next-env.d.ts` and required `jsx: "react-jsx"` plus dev type inclusion in `tsconfig.json`. [next-intl 4 upgrade notes](https://next-intl.dev/blog/next-intl-4-0) describe ESM, required locale return and provider inheritance; this app already supplies `locale`, wraps client components, and its request config returns a locale.

The registry peer probe found `next-auth@5.0.0-beta.32` accepts Next 16/React 19, and `next-intl@4.14.9` accepts Next 16/React 19. The Chakra/Prisma/React build and Auth.js/i18n behavior were exercised below; no major bump to those packages was made.

## Replayed checks (Node 22.22.0, macOS)

| Check | Result | Evidence |
| --- | --- | --- |
| Clean `npm ci` | PASS, exit 0 | `evidence/npm-ci.log` |
| `npm audit --omit=dev --json` | PASS, 0 Critical / 0 High / 0 Moderate | `evidence/npm-audit-production.json` |
| `npm run verify` | PASS | `evidence/verify.log` |
| `npm run lint` | PASS, 0 errors / 0 warnings | `evidence/lint.log` |
| Focused dependency/auth/admin/pricing tests | PASS, 32/32 | `evidence/targeted.log` |
| `npm run build` | PASS, Next 16 Turbopack | `evidence/build.log` |
| `NEXT_OUTPUT=standalone npm run build` | PASS, Next 16 Turbopack | `evidence/build-standalone.log` |
| Full `npm test` | **FAIL**, 1474 pass / 1 fail / 20 skip | `evidence/test-full.log` |

The full-suite failure is the unchanged B01-owned `tests/cli/agent-lifecycle.test.ts:152` SIGTERM lock assertion: `expected true to be false` after `agent.kill("SIGTERM")` and `waitForExit(agent)`. An earlier run in this worktree also failed at the same assertion (1472 pass / 1 fail / 20 skip). These failures are **not** a full-suite pass; the original final log is preserved. The coordinator observed the same flaky branch in a combined-tree probe and is handling it under B01. This migration does not modify lifecycle tests.

The full development-dependency audit is **not clean**: 2 Critical / 10 High / 4 Moderate (`npm audit` exit 1), recorded in `evidence/npm-audit-all.json`. The production-only 0 result must not be described as a zero-vulnerability whole-tree result. The remaining records include Vitest/Vite and ESLint/Tailwind build tooling. No `audit fix --force` or unsupported override was applied.

## Runtime scratch check

An isolated PostgreSQL 16 cluster named `tokenizer_e2e_b02` was initialized under `/tmp`, all 28 migrations were applied, and a production `next start` server ran with synthetic Auth.js secrets, `AUTH_TRUST_HOST=true` and a local `AUTH_URL`. `scripts/test-next16-auth-tenant.mjs` refuses non-local app URLs and non-`tokenizer_e2e_*` databases; it seeded two users with distinct real Prisma-backed Auth.js sessions and usage events, then cleaned them up (`User` fixture count 0). It verified:

- `/login` 200 in `zh-CN` and `en` with translated messages; linked built CSS 200.
- `/api/auth/providers` 200 with Resend; anonymous `/api/events` 401.
- Each user's `/api/events`, `/api/summary` and `/events` returned 200 and excluded the other tenant's event/device.
- Deleting a session made its cookie return 401.

See `evidence/runtime-auth-tenant.log`. The test does **not** send real email or exercise magic-link callback. It does not replace B01 Playwright, Linux Docker-image, Windows, staging or independent Evaluator checks. A separate standalone-server smoke copied `.next/static` and `public` exactly as `Dockerfile` does; with the server working directory set to `.next/standalone`, `/login`, providers and CSS returned 200. Docker itself could not run because the local daemon was unavailable.

## Remaining gates

1. Independent Evaluator must replay the exact candidate on Node 22/Linux, especially production audit, `npm ci`, build, cache invalidation and Auth.js/next-intl runtime.
2. Integrate with B01's browser CI only after reconciling shared `package.json`/lockfile/workflow changes. B01's production-mode browser job requires a **synthetic** `AUTH_RESEND_KEY`; the coordinator has separately added it. Re-run its real-browser authenticated two-tenant journeys against the combined Next 16 tree.
3. Resolve the B01 full-suite SIGTERM lock flake; run the complete test suite cleanly. Real Resend delivery/callback, Linux image build/startup, Windows CI, secret rotation and production configuration remain unverified here.
4. Do not mark B02 signed off or release/push based on this Generator handoff alone.
