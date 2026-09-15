# BL-CODEX-QUOTA-WINDOW

Release follow-up: after local acceptance, the user explicitly authorized commit,
push and deployment on 2026-09-16. See
`docs/test-reports/BL-CODEX-QUOTA-WINDOW-release-20260916.md` for main-batch
reconciliation and production verification; the original local scope below is
retained as the contract used by the independent evaluator.

## Approved scope
The user approved correcting the diagnosed quota-window label bug on 2026-09-16.
This work is isolated from the main workspace's unfinished batch. F001 owns
implementation and regressions; F002 is independent local verification.
No push, deployment, database migration, credential changes or agent version bump.

## F001 contract
- Read rawJson.limit_window_seconds when it is a positive safe integer, otherwise
  use finite positive rawJson.window_minutes converted to positive safe-integer
  seconds. Seconds take precedence.
- Missing, non-object, non-numeric, non-finite, zero, negative or unsafe metadata
  yields unknown duration unless a valid legacy minutes fallback is available.
- Format using the largest exact unit: weeks, days, hours, minutes or seconds.
  Do not round the period or infer it from position, plan, timestamps or countdown.
- 604800 seconds displays weekly; 18000 seconds displays five hours regardless of
  primary/secondary position. Apply the same rule to code-review windows.
- Unknown duration uses a localized explicit unknown label.
- Preserve percentages, reset times, freshness, account grouping/selection, DOM
  structure, CSS and layout. rawJson already carries duration; no new persistence.
- Test weekly-only primary, normal/swapped dual windows, all four ordinary and
  code-review positions, legacy minutes, other durations and invalid metadata.

## D-i18n
Replace position-based captions with subscription.codex.rateRemaining and
codeReviewRemaining, both with {window}. Add windowWeekly and windowUnknown.
Other durations use Intl.NumberFormat with localized long unit names; this
handles singular/plural forms without new ICU message patterns. English and
Simplified Chinese are authored directly. No industry-term allowlist changes.
Retain locale-key/placeholder parity tests and test actual rendered translations.

## F002 verification and delivery
Use a fresh Kimi process to inspect source and tests independently and write its
own verdict under docs/test-reports. Generator claims are not acceptance evidence.
Run focused tests, lint, typecheck and full tests where local prerequisites allow.
Production deployment and authenticated production browser checks are excluded.
Deliver uncommitted source/tests and verification/handoff artifacts in this
worktree. The orchestrator must reconcile batch metadata rather than overwrite
the main workspace's unrelated current batch.
