# B02 generator handoff: dependency, auth and configuration security

- Baseline: `2074991717abaf3cb34d9aad894bcd4357fefbc3`; detached worktree `tokenizer-b02-security-20261007`.
- Scope: proposed upgrade-plan M1/B02 and review R01, not a formal Harness feature or Evaluator signoff.
- Checked: 2026-10-07 UTC. No production access, deployment, push, gate decision or `progress.json` change.

## Implemented candidate

| Dependency | Locked before -> after | Reason |
| --- | --- | --- |
| `next` / `eslint-config-next` | 15.5.18 -> 15.5.27 | Same 15.5 line. Public `/login` Server Action reaches the [DoS advisory](https://github.com/vercel/next.js/security/advisories/GHSA-m99w-x7hq-7vfj) precondition; 15.5.27 also exceeds the [AVIF image-optimization fix](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4). The latter attack chain was not reproduced. [15.5.27 release](https://github.com/vercel/next.js/releases/tag/v15.5.27), 2026-09-30. |
| `next-auth` / `@auth/core` / `@auth/prisma-adapter` | beta.31 / 0.41.2 / 2.11.2 -> beta.32 / 0.41.3 / 2.11.3 | Resend magic-link path uses the affected default email normalizer. [Auth.js release](https://github.com/nextauthjs/next-auth/releases/tag/next-auth@5.0.0-beta.32), 2026-07-20, includes the [email normalization](https://github.com/nextauthjs/next-auth/security/advisories/GHSA-7rqj-j65f-68wh) and [configuration-error auth-object](https://github.com/nextauthjs/next-auth/security/advisories/GHSA-8fpg-xm3f-6cx3) fixes. Existing application authorization checks use `session.user.id` or role, not auth-object truthiness. |
| `undici` | 7.25.0 -> 7.29.1 | Same 7.x line; direct import in `src/cli/fetch.ts` for local-agent requests. [Maintainer release](https://github.com/nodejs/undici/releases/tag/v7.29.1), 2026-09-04, covers current 7.x advisories. This is not the public web server's direct HTTP entry. |
| `sharp`, `nanoid`, `source-map-js`, top-level `postcss` | 0.34.5 / 3.3.12 / 1.2.1 / 8.5.14 -> 0.35.5 / 3.3.20 / 1.2.2 / 8.5.29 | Lockfile-compatible refresh; [sharp 0.35.5 advisory](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w), 2026-09-30. No direct app API changes. |

`ADMIN_TOKEN=change-me` was a usable Compose default for the legacy header/cookie admin API. Compose now supplies no token by default; runtime rejects absent, short, padded and historical placeholder tokens before comparing them. The deploy preflight now requires a 32+ character `ADMIN_TOKEN` and `AUTH_RESEND_KEY`; the Auth.js runtime also fails closed on missing Resend key outside the production build phase. Neither error prints secret values. `AUTH_SECRET` retains its existing production-runtime/deploy checks. The minimum length is **not** proof of entropy: generate and rotate an unpredictable operator secret before deployment.

## Audit and reachability

`npm audit --omit=dev --json` reports affected **package records**, not independently exploitable vulnerabilities:

| Audit | Critical | High | Moderate | Total |
| --- | ---: | ---: | ---: | ---: |
| Baseline lockfile | 4 | 5 | 1 | 10 |
| Candidate lockfile | 0 | 1 | 2 | 3 |

Remaining `High` is `next@15.5.27`'s **exact nested** `postcss@8.4.31` (top-level PostCSS is updated). Next's CSS loader processes checked-in build input; `app/` and `src/server/` expose no CSS upload or server-side untrusted CSS processing route. The [PostCSS file-read advisory](https://github.com/postcss/postcss/security/advisories/GHSA-6g55-p6wh-862q) requires attacker-influenced CSS/source-map annotations. That prerequisite was not found in current application routes, so remote reachability is not established. We did **not** force an unsupported override of Next's exact dependency; this package record remains open. The Docker runner copies built standalone output rather than the full builder `node_modules`, but Linux image contents were not inspected because Docker daemon was unavailable.

The two `next-intl@3.26.5` moderate advisories remain. Current configuration has no `next-intl` middleware with `localePrefix: 'as-needed'` ([redirect advisory](https://github.com/amannn/next-intl/security/advisories/GHSA-8f24-v5vv-gm5j)) and no `experimental.messages.precompile` or untrusted translation catalog ([prototype-pollution advisory](https://github.com/amannn/next-intl/security/advisories/GHSA-4c35-wcg5-mm9h)). A 3.x -> 4.x upgrade is a separate compatibility migration, not hidden inside this patch. Reassess both if the app adds those paths. These are code-path inferences, not a claim that future configurations are safe.

## Replayed checks and limits

All commands used Node 22.22.0. Logs are in `evidence/`.

- Clean `npm ci`: pass. `npm run verify`, `npm run lint`, `npm run build` with a placeholder `DATABASE_URL`: pass. Build is not a real DB/runtime or Linux-image test.
- Targeted auth/admin/tenant-related suites: 8 files, 92 tests pass. Added regressions for weak admin token and missing/blank Resend config. Existing route tests mostly mock `@/auth`; this is **not** a real email/session/tenant E2E.
- Built Next production server, no DB: weak-token `POST /api/admin/cleanup-claude-legacy` returns 401; unauthenticated `GET /api/summary` returns 401. These are negative-path smokes only.
- Full `npm run test`: **failed three times** with SIGTERM lifecycle timing assertions in `tests/cli/agent-lifecycle.test.ts`. The two earlier runs each had 1465 pass / 1 fail / 20 skip; the latest full run had 1470 pass / 1 fail / 20 skip, before the final deployment-script whitespace regression was added. That last regression passed in the targeted suite. The lifecycle file independently passed 6/6; the rest of the then-current suite passed 1460/1460 when excluding it. All three full-suite failures remain recorded; exclusion is not a full-suite pass. R12/B01 owns this known flake.
- Not run: real Resend delivery, magic-link callback/session creation/revocation, two-user tenant isolation against scratch PostgreSQL, Linux Docker image build, Windows agent regression, production configuration/rotation or deployment.

## Open human gates

1. **Residual dependency acceptance:** repo maintainer/security owner (specific human owner to assign) must decide whether to accept the nested PostCSS High finding with the current no-untrusted-CSS boundary, or schedule a supported Next patch/isolated replacement. Proposed review by 2026-10-14; **not accepted yet**. Keep user-supplied CSS/source-map processing disabled and re-audit on each Next update.
2. **Moderate migration:** assign owner and date for `next-intl` 4.x compatibility work or explicitly accept the current non-reachable configuration; do not silently mark audit clean.
3. **Operational release gate:** human must provide/rotate `ADMIN_TOKEN`, confirm `AUTH_SECRET` and `AUTH_RESEND_KEY`, run real mail + session + two-tenant DB E2E and Linux image check, then independent Evaluator replays the diff and decides B02. Do not treat these generator checks as signoff or push this worktree.
