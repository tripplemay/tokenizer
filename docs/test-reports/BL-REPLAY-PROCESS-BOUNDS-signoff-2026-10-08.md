# Scoped local signoff — BL-REPLAY-PROCESS-BOUNDS (NOT production ready)

Scope: local macOS acceptance of F001–F004 plus F005 independent acceptance at
`3130cef3bc55528290c49ee35267e1aff33b5c78` only.

The independent Kimi-family evaluation is complete: all refusal/bounding controls were
re-derived from the spec and actual code (never from Generator claims), executed as real
subprocesses under synthetic homes with external watchdogs and owned-only cleanup, and all
standard gates were rerun green in a fresh-install sandbox. Full method, evidence, retained
failure logs and limitations: `BL-REPLAY-PROCESS-BOUNDS-kimi-20261008/README.md`; machine
verdict: `BL-REPLAY-PROCESS-BOUNDS-verdict.json`.

This signoff is explicitly bounded:

- **Release readiness: false.** Native Windows/Linux execution, exact-SHA CI, real PG16,
  authenticated browser / original homepage F005, service installers, production/staging and
  the full B03/B07 programme were not executed and are not inferred from local macOS results.
  Windows-only tests are recorded as explicit macOS skips, not passes.
- Timing results are scheduling allowances (startup 2,000 ms + declared 2,000 ms allowance;
  replay 10,000 ms operation deadline with reserved cleanup), not hard real-time guarantees:
  blocked synchronous filesystem syscalls, OS-suspended workers, deliberately escaped process
  groups and an unresponsive OS remain outside the enforced bound, matching the product's own
  declaration.
- The heavyweight baseline replay end-to-end reproduction (Generator's
  `baseline-reproduction.log`) was not rerun by this evaluator (time-boxed); baseline F1 was
  independently reproduced on exact `ba292a0` bytes, and baseline F2 was confirmed by code
  inspection plus empirically proven SIGTERM resistance of the evaluator's own shim.
- npm audit findings (Generator-recorded: 7 high) remain unremediated by design; this evaluator
  used `--no-audit` and did not re-derive them. No dependency changes occurred in this batch.
- Test-authoring note for future work only (not a defect): `git.ts` caches GitInfo per
  workspace per process; replay refusal controls must run each invocation in a fresh process.
- No human gate decision was written; `progress.json`/`features.json` transitions are left to
  the Coordinator. Nothing was pushed, deployed or committed by this evaluator.

Signed: Kimi evaluator instance `replay-process-bounds-3130cef-kimi-r0`, 2026-10-08 (UTC 2026-10-08T04:01Z).
