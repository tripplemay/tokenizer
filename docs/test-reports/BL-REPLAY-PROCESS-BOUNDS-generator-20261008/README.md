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

## F004

Product source is frozen at `1c85dba5724c84ccaa95140d510bf0548b677f44`.
F004 changes only new process-bounds tests/fixtures, this new evidence directory
and Generator state. Feature commits before this evidence checkpoint:

- F001: `d1e3ccf8c30b62a13c058f4c74c39b83a8de60ec`
- F002: `252aa6af4bdc8e4abcf0b9c52c59327097287360`
- F003: `1c85dba5724c84ccaa95140d510bf0548b677f44`
- Coordinator's F003 compatibility adjudication: `a14e6bf898221b7a9a8311cedd0ecd7478c2f09e`

`baseline-reproduction.log` records a disposable `git archive ba292a0` snapshot,
its own fresh npm ci (86,553 ms, no shared node_modules), and an independent
POSIX process-group watchdog. The unchanged baseline startup had to be killed
at 4,505 ms; the unchanged replay with a SIGTERM-resistant Git tree had to be
killed at 11,510 ms. Queue remained unchanged; all 7 tracked owned processes
were gone after cleanup. The snapshot was removed, not any original worktree.
The self-contained reproduction script is
`tests/fixtures/process-bounds/baseline-reproduction.ts`.

Run it with the synthetic environment above:

```
node --import tsx tests/fixtures/process-bounds/baseline-reproduction.ts "$PWD/docs/test-reports/BL-REPLAY-PROCESS-BOUNDS-generator-20261008"
```

Recorded command results (these are Generator checks, not F005 acceptance):

| Command | Artifact | Result |
| --- | --- | --- |
| npm ci | npm-ci.log | exit 0, 670 packages; npm reports 7 high vulnerabilities |
| npm run lint | final-lint.log | exit 0 |
| npm run verify | final-verify.log | exit 0 |
| npm run verify (after final fixtures/build) | final-verify-postbuild.log | exit 0 |
| npm run build | production-build.log | exit 0; local production build only |
| B03/B07/replay/privacy + process-bounds, verbose | final-focused.log | 188 passed / 6 skipped, exit 0 |
| npm test | full-default.log | 1919 passed / 34 skipped, exit 0 |
| npm test -- --maxWorkers=1 --no-file-parallelism | full-controlled.log | 1919 passed / 34 skipped, exit 0 |
| npm test (final fixture bytes) | full-default-final.log | 1919 passed / 34 skipped, exit 0 |
| npm test -- --maxWorkers=1 --no-file-parallelism (final fixture bytes) | full-controlled-final.log | 1919 passed / 34 skipped, exit 0 |

The two full-test pairs ran separately, not concurrently. The final pair follows
new-fixture-only Windows Path key handling and timing-evidence additions, not
old-test changes. The final default run used synthetic HOME
`/private/tmp/tk-pb-default-home`; controlled used
`/private/tmp/tk-pb-controlled-home`; each had its own sibling `*-tmp` directory.
Build/lint/verify used `/private/tmp/tk-pb-build-home` and `*-tmp`.
No DATABASE_URL, DIRECT_URL, RUN_DB_PROBE_TESTS, RUN_PG_INTEGRATION_TESTS,
NEXTAUTH_URL or AUTH_SECRET were present in the command environment.

The final verbose focused command was:

```
npm exec -- vitest run tests/cli/b03*.test.ts tests/cli/b07*.test.ts tests/cli/replay*.test.ts tests/cli/privacy*.test.ts tests/cli/process-bounds --reporter=verbose --silent=false
```

It records real startup stall fallback in 2,079 ms; resistant-tree preview
refusal in 8,067 ms and independently confirmed execute refusal in 8,035 ms,
with both owned processes gone and queue/cursor/config unchanged. Four delayed
Git invocations refuse at 8,044 ms rather than resetting the operation budget.
These measurements describe this native macOS run, not universal timing limits.

`final-input-inventory.json` records SHA-256 hashes of 18 product/test/fixture
files and verifies all 1,277 pre-existing tracked tests/reports against baseline
Git blobs (zero changed inputs). `input-inventory.json` retains the earlier
snapshot, before the final fixture-only additions. Inventory command:

```
node tests/fixtures/process-bounds/inventory.mjs <explicit-output.json>
```

## Unexecuted gates and limitations

- F005 remains pending; independent Kimi-family acceptance and final spec-lock
  critic are Coordinator-owned. This is not a signoff.
- Native Windows and Linux exact-candidate execution was not performed. Three
  new Windows-only controls are explicitly skipped on macOS. Windows fixture
  creation requires the OS .NET C# compiler and produces an actual executable.
- PG16, deployed browser/homepage F005, release/deployment/production acceptance,
  dependency vulnerability remediation and the full B03/B07 programme remain
  outside this slice. npm ci's 7 high vulnerabilities were not silently fixed.
- Startup execution budget, replay operation deadline and cleanup/watchdog
  allowances are distinct. No universal hard real-time or blocked filesystem
  syscall guarantee is made. Deliberately escaped groups and OS suspension are
  outside the tested bound.
- No push, production request, native service installation, real-home source
  or queue read, human gate decision or historical evidence rewrite occurred.
