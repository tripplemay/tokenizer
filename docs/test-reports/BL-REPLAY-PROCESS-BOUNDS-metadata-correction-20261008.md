# Metadata correction — BL-REPLAY-PROCESS-BOUNDS verdict batch_id (2026-10-08)

Task: `replay-process-bounds-3130cef-kimi-metadata` (batch `BL-REPLAY-PROCESS-BOUNDS`, contract `harness/1.1`, evaluator, metadata-correction-only scope).

## What happened

The prior registered Kimi evaluator task `replay-process-bounds-3130cef-kimi-r0` produced a
schema-valid verdict whose `batch_id` was set to `BL-REPLAY-PROCESS-BOUNDS-F005`. That value is
`progress.json.current_sprint` — the current *feature cursor* (batch + in-flight feature F005) —
not the commissioned batch id. The commissioned envelope (`batch: BL-REPLAY-PROCESS-BOUNDS`) and
the frozen `features.json` (`"batch": "BL-REPLAY-PROCESS-BOUNDS"`, spec
`docs/specs/BL-REPLAY-PROCESS-BOUNDS-spec.md`, features F001–F005) identify the batch as
`BL-REPLAY-PROCESS-BOUNDS`, matching the deliverable filename itself.

This task was commissioned to correct that one metadata field and nothing else.

## Verification of the claimed relationship (from actual files, 2026-10-08)

- Original artifact read from the r0 worktree, unmodified:
  `.../BL-REPLAY-PROCESS-BOUNDS-local-cli--kimi--evaluator-replay-process-bounds-3130cef-kimi-r0/docs/test-reports/BL-REPLAY-PROCESS-BOUNDS-verdict.json`
  → line 2: `"batch_id": "BL-REPLAY-PROCESS-BOUNDS-F005"`.
- Exact SHA: r0 worktree HEAD = `3130cef3bc55528290c49ee35267e1aff33b5c78` = this sandbox HEAD =
  commissioned `repo.ref`. `git status` in the r0 worktree shows only the three untracked
  evaluator artifacts (verdict, signoff, report directory) — no product/state modification.
- Frozen `features.json` (tracked at that SHA): `"batch": "BL-REPLAY-PROCESS-BOUNDS"`.
- `progress.json`: `current_sprint: "BL-REPLAY-PROCESS-BOUNDS-F005"` — confirmed to be the
  feature cursor, not the batch id.
- Companion artifacts confirmed present and consistent: scoped signoff
  `BL-REPLAY-PROCESS-BOUNDS-signoff-2026-10-08.md` (signed by instance
  `replay-process-bounds-3130cef-kimi-r0`, release readiness false) and report directory
  `BL-REPLAY-PROCESS-BOUNDS-kimi-20261008/` (README, probe logs, focused/full logs, inventory,
  probes).

## Correction applied

- Old `batch_id`: `BL-REPLAY-PROCESS-BOUNDS-F005`
- New `batch_id`: `BL-REPLAY-PROCESS-BOUNDS`
- File: `docs/test-reports/BL-REPLAY-PROCESS-BOUNDS-verdict.json` (this sandbox only; the r0
  worktree and its original artifacts were not altered).

Equality check, excluding only `batch_id`:

- Pre-edit copy was byte-identical to the original (SHA-256
  `e32cc2a1420c6898440278285eb5e7a7c665c43d37ee7a4444abc0524176900a` both sides).
- Post-edit `diff` original vs corrected: exactly one line differs (line 2, `batch_id`).
- Parsed-JSON comparison with `batch_id` removed from both: **equal** — every other field and
  value (`fix_round: 0`, `created_at: 2026-10-08T04:01:20.000Z`, `waiting: null`, all five
  feature verdicts F001–F005 with their `result`/`evidence`/`steps_to_reproduce` strings) is
  preserved exactly, including all timestamps, limitations and the recorded probe-v1 evaluator
  bug notes.

## Scope statements

- **No new product verification occurred in this task.** No product tests were rerun, no probes
  re-executed, no acceptance re-derived. The corrected artifact inherits the r0 evaluation's
  evidence as-is; this is not permission to soften or strengthen any finding.
- **Release readiness remains false**, per the scoped signoff: native Windows/Linux execution,
  exact-SHA CI, real PG16, authenticated browser / original homepage F005, service installers,
  production/staging and the full B03/B07 programme were not executed and are not inferred;
  timings are scheduling allowances, not hard real-time guarantees.
- No commit, push, deploy, human gate decision, or change to product/config/state/spec files.
  Coordinator transports the original and corrected artifacts unchanged.

Signed: Kimi evaluator instance `replay-process-bounds-3130cef-kimi-metadata`, 2026-10-08.
