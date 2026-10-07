# B01 SIGTERM round 2 independent evaluator report

- Candidate: `7b4290b3adf1bd56a395cac7840002e73df98daf`
- Round 1 baseline: `e684bbd7b898fd982c5e505b8543d487920fa8ea`
- Scratch tree: `/Volumes/ORICO/project/.worktrees/tokenizer-b01-sigterm-r2-eval-20261007`
- Verdict: **PASS for safe-branch CI**
- Local code blocker: **none found**
- Release ready: **NO — native Windows Node 22 CI has not run**

## Round 1 blocker disposition

`B01-SIGTERM-WINDOWS-PID-BOUNDARY` is fixed in source. The Windows-only test now
starts `process.execPath --import tsx ...` directly, matching the command built
by `src/cli/service-windows.ts`. It waits for running state and proves both
`agent.lock.pid` and state PID equal the spawned PID. It also proves a live
owner rejects reclaim without changing the lock, force-kills that owner,
checks the lock and running state remain byte-identical, then proves stale-lock
recovery changes the token and finally removes the successor lock.

An independent POSIX hard-kill execution of the same direct-owner contract
passed: PID `51302` owned the lock, live reclaim was rejected, SIGKILL left the
lock/state unchanged, the owner was dead after close, and successor acquisition
changed the token and released cleanly. This validates the process/lock logic,
not native Windows signaling.

## Native Windows focused gate

The `verify-windows` job remains Node 22 and retains the full suite. It now also
runs the exact Windows owner test with Vitest JSON output, then invokes
`scripts/ci/assert-windows-agent-owner.mjs`. The checker requires:

- native `process.platform === "win32"`;
- successful report and zero failed tests;
- exactly one passed test overall;
- exactly one assertion with the exact target name and `status === "passed"`.

The eight checker tests passed and cover passed, skipped, pending, failed,
missing/renamed, duplicate, unsuccessful-report, and non-Windows cases. Running
the workflow command on macOS produced eight skipped assertions and Vitest exit
0; the checker then correctly exited 1 before reading that as acceptance. A
schema-preserving simulated Windows report containing the exact passed target
was accepted. `actionlint` also passed.

This gate is sufficient to enter a safe branch CI run: a skipped or non-Windows
execution cannot become green acceptance. It is not evidence that Windows
itself has passed.

## POSIX wrapper pre-spawn SIGTERM

The wrapper now registers signal handlers before calling `spawn`, retains an
early pending signal, installs child error/close handlers, and only then relays
the pending signal.

The independent deterministic comparison used the same preload boundary for
both revisions:

| Revision | Wrapper exit | Child after wrapper exit |
| --- | --- | --- |
| Round 1 `e684bbd` | `{ code: null, signal: "SIGTERM" }` | alive/orphaned |
| Round 2 `7b4290b` | `{ code: 0, signal: null }` | stopped |

The round 2 wrapper and direct-agent SIGTERM cases also passed 32/32 independent
stress processes at parallelism 8.

## Node 22 independent execution

Environment: macOS arm64, Node `22.22.0`, npm `10.9.4`, fresh worktree with no
`node_modules`, followed by cold `npm ci`.

| Check | Result |
| --- | --- |
| Cold `npm ci` | PASS; 641 packages; audit reported 21 existing vulnerabilities |
| Lifecycle + Windows gate focused tests | PASS; 15 passed, 1 Windows-only skipped |
| Parallel SIGTERM/wrapper pressure | PASS; 32/32, parallelism 8 |
| Full `npm test` | PASS; 1525 passed, 22 skipped; 113 files passed, 8 skipped |
| `npm run lint` | PASS; no warnings/errors |
| `npm run verify` | PASS |
| Placeholder-DB `npm run build` | PASS |
| `node --check`, `actionlint`, source `git diff --check` | PASS |
| Native Windows runtime | NOT RUN |

## Release boundary

The candidate has no remaining locally demonstrated blocker and is ready to be
pushed only to a safe branch for CI validation. `release_ready` remains false
until a real `windows-latest` Node 22 run produces the uploaded focused JSON
artifact and passes both the full Windows suite and exact checker. Final B01
release additionally requires the integrated SHA's existing Linux, database,
browser, and contract gates. This report does not approve main push, deployment,
Task Scheduler/VBS behavior, production service-manager behavior, or historical
F005 acceptance.

Evidence is under `sigterm-round2-independent-eval-evidence/`.
