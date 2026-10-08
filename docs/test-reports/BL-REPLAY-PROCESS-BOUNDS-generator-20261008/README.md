# Generator execution evidence: BL-REPLAY-PROCESS-BOUNDS

This directory records Generator implementation checks, not independent
acceptance or release signoff. Product baseline: ba292a0. Spec checkpoint:
1bd6b6c. All work occurs in the isolated takeover worktree; no push or deploy.

Environment: Node 22.22.0 from
`/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin`; synthetic HOME/USERPROFILE
`/private/tmp/tk-pb-home`, TMPDIR `/private/tmp/tk-pb-tmp`, npm cache
`/private/tmp/tk-pb-cache`. `npm-ci.log` is a fresh independent `npm ci`.

## F001

`F001-focused.log`: new native primitive tests (19 passed, 1 Windows-only skip).
Command: `npm exec -- vitest run tests/cli/process-bounds/bounded-subprocess.test.ts`.

The synchronous caller launches a Node worker that asynchronously supervises
an explicit executable/argv. Combined child stdout/stderr and the base64 worker
response are bounded. POSIX children own a new process group. Windows uses
`taskkill.exe /T /F` with a bounded direct-child fallback. Errors never include
captured stdout/stderr. No child PID is discovered by process-name scanning.

Timing: requested execution budget + 1,000 ms cleanup + 1,000 ms worker
startup/response watchdog allowance. Windows watchdog failure can consume a
further 1,000 ms emergency tree-cleanup attempt; replay reserves the total.
The worker publishes only its owned child PID before result delivery, so the
parent can clean that group when worker supervision fails. The worker waits
for close up to its cleanup allowance before responding. Fixtures have an
independent 15-second lifetime cap and cleanup is limited to recorded fixture
PIDs/groups. These bounds do not claim hard real-time behavior under suspended
workers, blocked synchronous syscalls, escaped groups or an unresponsive OS.

## F002

`F002-focused.log`: 27 passed / 2 Windows-only skipped across F001 and F002.
`F002-verify.log`: `npm run verify`, exit 0.
Startup Git receives 2,000 ms execution and 128 combined output bytes. A
successful unsignalled exit with a 12-64 hexadecimal abbreviated SHA is required.
Real subprocess controls cover SIGTERM resistance, overflow, invalid/short SHA,
nonzero and signal exits. The healthy case matches the install checkout SHA;
a disposable install checkout advances after module import without changing
the imported snapshot. Windows fixture construction produces a native git.exe
via the OS .NET compiler, not a .cmd wrapper; Windows execution remains unrun.

## F003

Replay-bound Git uses the worker with 64 KiB combined output and Windows reparse
checks use 16 KiB. Each call subtracts the declared supervision/cleanup allowance
from the same operation deadline; ordinary collection still uses its prior
Git path. Timeout/output/signal/supervision failures refuse without raw streams.

`F003-focused.log`: 34 passed / 2 Windows-only skipped. Real resistant child
trees refuse both preview and independently confirmed execution in under the
10-second replay deadline; queue/cursor/config bytes remain unchanged. Real
successive delayed Git calls share one deadline. A queue-lock clock control
trips the production before-mutate guard without changing state.

`F003-original-focused.log` preserves the initial 5 old-test failures:
nonexistent historical workspaces were incorrectly passed as worker cwd,
conflating target ENOENT with supervisor launch failure. Coordinator adjudication
`a14e6bf` permits only a structured target-cwd transport fix in the helper pair.
Worker now starts from caller cwd; target ENOENT is a typed launch absence.
Other launch errors and actual worker failure remain fail-closed. Added distinct
missing-target and broken-worker controls. No old test bytes changed.

`F003-adjudicated-focused.log`: unchanged B03/B07/replay/privacy cases plus new
controls, 187 passed / 5 skipped across 25 files. `F003-verify.log` preserves
an initial new-test TypeScript ProcessEnv annotation failure; the new test uses
Partial<ProcessEnv>. `F003-verify-rerun.log`, `F003-final-verify.log` and
`F003-lint.log` record subsequent checks separately.
