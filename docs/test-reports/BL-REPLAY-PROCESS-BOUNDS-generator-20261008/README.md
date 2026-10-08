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
