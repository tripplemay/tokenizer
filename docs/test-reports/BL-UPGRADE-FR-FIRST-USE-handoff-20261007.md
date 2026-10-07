# First-use and empty-window frontend handoff

Base: `2074991717abaf3cb34d9aad894bcd4357fefbc3` (detached worktree). Scope: FR-001 and FR-007 from `frontend-review-20261007` only.

## Implemented

- `app/page.tsx`: mount the existing 30-second, visible-only, serial `AutoRefresh` on first-use and selected-window empty states. An initial cached empty result may still be served once by `unstable_cache`'s 30-second stale-while-revalidate policy; the next scheduled refresh can consume the recomputed value. No competing poller or global cache invalidation was added.
- Distinguish all-time no usage from selected-window no usage using `getSummary(...).lastEventAt`, which is already queried across all time. The latter retains the range selector and displays a bounded, tenant-scoped list of up to five current device statuses instead of installation onboarding.
- For all-time no usage, query the latest enrolled device directly: a newly registered device receives a waiting-for-first-sync state and device-status link; an unregistered user retains the install flow.
- New onboarding and empty-window copy is provided in both locale files.
- `tests/shared/home-first-use.test.ts` covers the fresh, enrolled-awaiting-sync, historical empty-range, and empty-to-dashboard render branches. Existing `tests/shared/auto-refresh.test.ts` covers serial transition scheduling and visibility behavior.

## Verification

- Focused tests: 7 passed.
- Full `npm run test`: 1,457 passed, 20 skipped after final change.
- `npm run verify`, `npm run lint`, and `npm run build`: passed after final change.

## Boundaries

- This is Generator handoff, not an independent Evaluator verdict or F005 signoff. No `progress.json`, `features.json`, `backlog.json`, gate decision, production, or original worktree was changed.
- No authenticated browser + real PostgreSQL replay was performed in this branch. Independent verification should replay fresh enrollment -> first API upload -> idle visible tab (> two cache TTLs) -> dashboard without manual reload, plus historical usage outside 7d -> range selector/status -> All.
- This branch does not solve broader cache correctness, stale last-success indicators, or the separately reported locale gaps in `EnrollFlowCard`.
