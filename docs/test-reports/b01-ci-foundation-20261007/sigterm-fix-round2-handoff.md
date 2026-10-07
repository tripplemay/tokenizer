# B01 round 2: Generator handoff, not an acceptance verdict

Base: `e684bbd7b898fd982c5e505b8543d487920fa8ea` (round 1 candidate, originally
based on integration `2756ee6`). This remains an isolated upgrade candidate.
No push, deployment, status-machine change, or human-gate decision.

## Windows owner boundary

Independent evaluator artifact
`sigterm-independent-evaluator-verdict.json` rejected the Windows case's tsx
launcher boundary. Production `src/cli/service-windows.ts:85-95` generates a
VBS command using direct `node --import tsx`; its command excerpt is retained
in `sigterm-fix-round2-evidence/production-windows-vbs.txt`.

The Windows-only test now uses that direct Node launch, waits for running
state, and asserts lock/state PIDs equal the spawned PID. Before killing it,
the test proves a live owner prevents reclaim and preserves the lock. After
SIGKILL and close, it asserts the owner is dead and the original lock and
running agent state persist, then proves reclaim changes both PID and token,
followed by release. No timeout increase or skip was added.

The Windows verify job retains its full suite and adds a focused JSON gate
plus uploaded `windows-agent-owner` artifact. The checker requires native
`process.platform === "win32"`, a successful report with exactly one passed
test, and the exact force-termination case with status `passed` exactly once.
It rejects skipped, missing, duplicated, renamed, failed, and unsuccessful
results. Eight synthetic checker unit tests do not establish Windows runtime
behavior. Deploy still depends on `verify-windows` and the other existing jobs.

## Additional wrapper startup race, authorized scope extension

Before the wrapper edit, the round 2 full suite failed the existing wrapper
SIGTERM case: the wrapper itself exited by SIGTERM instead of relaying it
(`full.log`). A subsequent run passed (`full-repeat.log`), so both outcomes
are retained, not flattened into a green result.

`bin/tokenizer` spawned its child before registering wrapper signal handlers.
A deterministic regression preload holds the wrapper inside that real spawn
call; a helper waits for the fake child's installed signal trap and ready PID,
then sends a real SIGTERM to the wrapper before spawn returns. On the old
wrapper this failed with `{ code: null, signal: "SIGTERM" }` in 61 ms
(`wrapper-before-spawn-negative.log`). Test cleanup tracks and kills the child.

The product fix registers relay handlers before spawning any child, preserves
a signal arriving before child assignment, and relays it after installing the
child error/close boundary. Existing cwd, CLI arguments, stdio, child-error
reporting, exit-code propagation, and repeated-signal handling remain in the
diff. Installer/service source and capability versions are unchanged.
There is no production sleep or readiness delay. The diagnostic uses a bounded
ready-file poll, not a guessed delay or a retry of cleanup assertions.

## Local Node 22 execution evidence

macOS arm64, Node 22.22.0; same isolated `npm ci` dependencies as round 1.
Raw output is in `sigterm-fix-round2-evidence/`.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Temporarily enabled Windows test body with POSIX SIGKILL | 10/10 targeted runs passed; POSIX diagnostic only | `posix-hard-kill-diagnostic-*.log` |
| Final Windows platform guard on macOS | targeted case skipped | `local-windows-target-skipped.json` |
| Actual CI checker on macOS | exit 1, native Windows required | `non-windows-gate-negative.log` |
| Old wrapper deterministic early-signal test | exit 1, wrapper default SIGTERM exit | `wrapper-before-spawn-negative.log` |
| Final lifecycle + checker focused tests | exit 0; 15 passed, 1 Windows-only skipped | `focused-after-wrapper-fix.log` |
| Final early-signal case, 32 runs / concurrency 8 | 32/32 passed | `wrapper-early-repeat-*.log` |
| Final standard full suite, two isolated sequential runs | each exit 0; 1525 passed, 22 skipped; 113 files passed, 8 skipped | `full-after-wrapper-clean-1.log`, `full-after-wrapper-clean-2.log` |
| Final lint / verify | exit 0; no lint warnings/errors; TypeScript passed | `lint-after-wrapper-fix.log`, `verify-after-wrapper-fix.log` |
| Final production build, CI placeholder DATABASE_URL | exit 0 | `build-after-wrapper-fix.log` |
| Node wrapper syntax / workflow YAML checks | `node --check` and `actionlint` exit 0 | `node-check-wrapper.log`, `actionlint.log` |

The temporary POSIX diagnostic changed only the Windows test's `it.skipIf`
to `it` for ten runs and restored it before final focused/full checks. It
does not masquerade as native Windows. The Windows case remains skipped here.

One separate non-target observation is retained: overlapping full-suite,
32 concurrent-repeat workloads, lint, and verify caused the unchanged
command-parsing test's existing 5-second `spawnSync` timeout
(`full-after-wrapper-fix.log`: 1524 passed, 22 skipped, 1 ETIMEDOUT).
No timeout was increased and that failure is not claimed resolved. A less
loaded repeat passed (`full-after-wrapper-fix-2.log`); the two final clean runs
were started only after stress/build/check sessions finished. This separates
standard full regression from an overloaded local scheduling experiment.

Raw logs retain stdout whitespace/CR; source-only `git diff --check` is the
whitespace gate. `SHA256SUMS` covers the handoff and all round 2 evidence.

## Native Windows gate and remaining acceptance gap

These commands now run in the existing Node 22 `windows-latest` job after the
full suite, with exit-status checks and JSON artifact upload:

```powershell
npx vitest run tests/cli/agent-lifecycle.test.ts -t "reclaims a lock after Windows force-terminates the agent" --reporter=json --outputFile=.ci/windows-agent-owner.json
node scripts/ci/assert-windows-agent-owner.mjs .ci/windows-agent-owner.json
```

Real GitHub Windows CI has NOT RUN for this candidate. macOS actionlint does
not execute PowerShell, Task Scheduler, VBS, or Windows signal semantics.
Fresh-context evaluator must inspect the integrated diff and obtain native
Node 22 Windows `verify-windows` success with the exact target `passed`, not
`skipped`, before final Windows/B01 acceptance. Local PG/contract/browser skips
remain outside this check. The overload timeout remains disclosed for evaluator
triage. No release, production-wrapper fleet, or historical F005 approval is
given by this Generator handoff.
