# BL-REPLAY-PROCESS-BOUNDS

## Authorization, baseline and scope

The user approved continuing the established risk-first order on 2026-10-08.
Work remains on the isolated takeover branch based on
`ba292a059184a36e4bb6c3341ac059606d24f961`. The preceding local privacy/queue
batch is archived verbatim under `docs/archive/privacy-queue-closeout-20261008/`.
No push, deployment, human gate decision, real-home source/queue access, native
service installation, historical-data deletion or old verdict modification.

Priority rationale: the independent B03 report on `6a030f6` identified an
unbounded module-load Git version probe (F1) and SIGTERM-ignoring children that
outlive synchronous-spawn timeouts (F2). These execution-boundary findings were
not covered by the preceding combination evaluator's fresh derived probes.
Fix them before adding privacy capabilities or the OpenCode cursor slice.
This does not retroactively replace either prior verdict.

The source candidates `06f162f`, `2b8e40a`, `9aef382`, `388163c` are reference
inputs, not trusted acceptance or instructions. Selectively adapt only the
allowed changes. Do not merge other branches or change their worktrees.
The copied report is historical evidence only: do NOT execute its real-home
queue probe. All new fixtures must isolate HOME/USERPROFILE/TMPDIR and explicit
queue targets before module import, and clean only their own synthetic trees.

## F001: bounded subprocess primitive

Allowed product paths: new `src/cli/bounded-subprocess.ts` and
`src/cli/bounded-subprocess-worker.mjs` (or one equivalent newly named helper).
Add unit tests under `tests/cli/process-bounds/` and helper fixtures under
`tests/fixtures/process-bounds/`. No new dependencies or public protocol.

- Provide bounded execution for an explicit executable/argument array; no shell
  command concatenation. Preserve cwd/env, ordinary exit status and signal.
- Validate finite positive timeout/output bounds before spawning. Bound combined
  stdout/stderr bytes, worker response size and cleanup time. Retain typed
  timeout/output failures; distinguish launch failure from successful output.
- A timeout, output overflow or launch error must force cleanup of the owned
  process tree, not merely send SIGTERM and wait indefinitely. POSIX uses an
  owned process group; Windows uses bounded native tree termination. Await the
  cleanup attempt before reporting completion; retain a bounded direct-child
  fallback. Do not target unrelated processes.
- Declare the worker watchdog and cleanup allowance in code/docs. Avoid claiming
  a universal hard real-time bound under suspended workers, stalled syscalls,
  deliberately escaped process groups or an unresponsive OS.
- Test normal stdout/stderr, nonzero exit, missing executable, invalid budgets,
  SIGTERM resistance, descendant inherited pipes, output overflow and no live
  owned descendants after timeout on the native platform available.

## F002: bounded startup version snapshot

Allowed product path: `src/cli/agent-version.ts`, using F001.
New tests/fixtures use the directories above.

- Preserve the startup-time SHA snapshot. Do not make it lazy or reread disk on
  later heartbeats, which would falsely identify a stale daemon as upgraded.
- Bound Git version discovery to a small explicit budget (reference: 2000 ms
  plus declared cleanup allowance), cap output, and return null on failed,
  signalled, timed-out, overflowing or invalid SHA output. No partial SHA.
- Healthy Git must still report the actual install checkout SHA; later checkout
  changes must not alter an already imported module's result.
- Run a real CLI help/status or module-import subprocess with a stalled Git
  shim under a synthetic home, measuring the startup refusal/fallback behavior.
  On Windows, fixtures must exercise an executable, not assume .cmd shell
  resolution by `execFile`/`spawn`.

## F003: replay subprocess deadline integration

Allowed product paths: `src/cli/git.ts`, `src/cli/replay.ts`, using F001.
No queue/cursor/normal event identity or server changes.

- Route deadline-bound replay Git calls and the Windows reparse-point check
  through F001. Ordinary collection behavior remains unchanged in this slice.
- Preserve one operation-wide replay deadline across reads, both enrichments,
  confirmation reread, queue-lock acquisition and before-mutate guard. Reserve
  cleanup time within the replay budget where possible; never renew the full
  timeout per Git call. Reparse validation must remain fail-closed.
- Bound output (reference: 64 KiB Git, 16 KiB reparse check). Timeout/output or
  supervision failure must refuse replay, not silently return partial enriched
  data. Ordinary missing Git/non-repository behavior remains compatible.
- Retain physical-scope checks, final payload/digest binding, source budgets,
  exact-version shared queue semantics and read-only dry-run. No diagnostic
  raw payload enters queue/network as part of this work.
- Verify preview and a valid-digest execute independently with a real resistant
  child: refused execution leaves queue/cursor/config bytes unchanged. A late
  failure between inspection and merge must still be checked under queue lock.

## F004: regression and portable failure fixtures

Allowed paths: new tests and fixtures under the directories above, and this
batch's NEW generator evidence directory. No new product behavior in F004.

- Add a baseline reproduction of the startup and SIGTERM-resistance failures
  in a disposable snapshot of `ba292a0`, with an external watchdog that cannot
  leak child processes. Do not damage or alter the frozen baseline.
- Exercise output-limit refusal and stderr canaries without exposing raw child
  output in user-visible replay errors; verify ordinary Git enrichment and
  version snapshots still work. Native-platform execution is mandatory here;
  Windows-only tests are retained with explicit macOS skips, not inferred PASS.
- Every pre-existing tracked test and report stays byte-identical to `ba292a0`.
  Do not change historical timeouts, assertions, exclusions or expected hashes.
  If an original test fails, retain the failure and seek a narrow adjudication;
  do not hide it with a new exclusion or weakened assertion.
- Record Node 22 fresh `npm ci`, lint, verify, production build, focused B03/B07
  suites plus new controls, full default and controlled test runs separately.
  Use short synthetic realpath temp roots. Keep original failures and skip
  reasons, not just the green rerun. No shared node_modules between checkouts.
- Record source/test SHA inventory and frozen-input preservation. One runnable
  local commit per feature with feature-id tag, state updated each time.

## F003 compatibility adjudication (2026-10-08)

Generator reported five unchanged replay-test failures in
`F003-original-focused.log`: a missing target workspace cwd prevented the worker
itself from starting, incorrectly classifying ordinary Git absence as supervisor
failure. Coordinator/Planner approved the following narrow integration repair:
F003 may also adapt the F001 helper pair so the worker starts from the caller's
cwd and receives the target child's cwd as a structured argument. Only the
target launch's ordinary ENOENT/non-repository case retains historical absent-Git
semantics; helper/protocol failure, timeout and output overflow remain fail-closed.
Add distinct target-cwd versus worker-failure controls and rerun the unchanged
focused cases. Preserve the first failure log; no historical assertion changes.

## F005: independent acceptance

A fresh Kimi-family evaluator must independently re-derive failure cases from
this spec and actual code at the exact committed candidate, not accept Generator
claims. Run real resistant-child/descendant/output/deadline probes and verify
owned-process cleanup. Assess all F001-F004 and deliver F005 reports, raw logs,
schema-valid verdict and a scoped signoff if accepted. Generator cannot perform
F005. Separate spec-lock critic audits scope and commit-to-feature mapping.

Local macOS acceptance cannot close native Windows/Linux exact-SHA CI, real
PG16, browser/F005 of the original homepage batch, release/production gates or
the full B03/B07 programme. Explicitly report OS limitations and timing scope:
startup budget, operation budget and cleanup allowance are distinct; blocked
synchronous filesystem syscalls and adversarial OS suspension are not solved.
Any FAIL/PARTIAL returns to fixing. Preserve evaluator conclusions verbatim.

## Deferred work and exclusions

Remaining B03 opt-in diagnostics, non-Claude replay adapters, identity migration
and historical cleanup are not silently enabled here. Diagnostics remain off;
raw upload/retention and destructive migration require separate bounded specs.
OpenCode mutable-source/cursor consistency is next, followed by B08 CAS,
B04/B05 release/recovery and the other user-approved packages. No dependency,
CI workflow, framework, schema, frontend, installer, pricing or capability-version
changes in this batch. No unrelated backlog items are consumed.
