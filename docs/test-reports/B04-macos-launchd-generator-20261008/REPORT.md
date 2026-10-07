# B04 macOS launchd Generator handoff

This is a Generator handoff, not an evaluator verdict or a release approval.

## Candidate

- Base: `8877a592d21305f03cdaea5d874d58a581e910a1`
- Implementation commits: `cea6f5e21330c70aefd4eb534cb53f05d08e152b` and cleanup hardening `9e18e41823579fa1915adfdd4acde05dbd896ad7`.
- Scope: macOS launchd isolation support, native lifecycle fixture, fail-closed CI gate, and gate regression tests.
- Release manifest, release version, and release tag: unchanged.

## Implemented behavior

- `src/cli/service.ts` keeps the production identity `cc.tokenizer.agent` unchanged. A fixture identity is accepted only when both test environment variables are set, the label matches `cc.tokenizer.agent.ci.*`, and `HOME` is inside the OS temporary directory.
- Fresh launchd installation no longer fails merely because there is no previously loaded plist: the pre-load `launchctl unload` is best-effort; the subsequent real `launchctl load` remains fail-closed.
- `tests/cli/agent-release-installer-macos.test.ts` runs the real POSIX installer, CLI wrapper, Agent child, and user launchd GUI domain. It verifies:
  - fresh install and live launchd/Agent PIDs;
  - pinned upgrade and replacement of the old Agent PID;
  - post-cutover `configure` failure restoring the prior release and restarting its service;
  - offline explicit rollback;
  - byte-preserved credentials and queued event;
  - default launchd label presence unchanged;
  - unload plus zero scoped processes during cleanup.
- The fixture uses a unique temporary `HOME`, service label, plist, repository, releases directory, and dependency cache. `afterEach` is the normal failure cleanup boundary; it unloads only the unique plist, waits for scoped processes, and force-kills only command lines containing the fixture root if graceful cleanup fails. The CI step additionally installs an `EXIT INT TERM` shell trap. Its cleanup record is accepted only for the `cc.tokenizer.agent.ci.*` namespace and a fixture root below `RUNNER_TEMP`.
- `.github/workflows/deploy-vps.yml` adds independent job `verify-macos-agent` on `macos-latest`. It fails if the native `gui/$UID` domain is unavailable, requires one exact non-skipped JSON result, uploads the evidence with `if-no-files-found: error`, and is required by both the OCI/recovery job and Deploy.

## Local native evidence

Host: macOS 26.6.2 (25G83), arm64. Node: v22.22.0.

- `npm ci`: pass.
- `npm run verify`: pass.
- `npm run lint`: pass.
- `actionlint .github/workflows/deploy-vps.yml`: pass.
- `git diff --check`: pass.
- Focused launchd identity/gate tests: 15/15 pass.
- Native fixture plus exact JSON gate: 1/1 pass on real `launchctl` GUI domain.
- Full Vitest suite: 132 files passed, 9 skipped; 1710 tests passed, 23 skipped.
- Last full-suite native observation: fresh, upgraded, failure-restored, and offline-rollback commits were distinct; four Agent child PIDs were distinct; credentials and queue were retained; default label presence matched before/after; scoped process count after unload was zero.

The native fixture deliberately copies the already clean-installed dependency tree into its temporary root, then links each staged release to that temporary cache. This avoids letting launchd execute through an external-volume dependency symlink on the local host while still executing the real Node/tsx application. It does not replace the outer job's clean `npm ci`.

## CI path and handoff status

Expected safe-branch path:

1. `verify-macos-agent` checks out this exact candidate.
2. setup-node installs Node 22 and `npm ci` installs dependencies.
3. the job proves `launchctl print gui/$UID` works; absence is a hard failure, never a skip/mock.
4. the native fixture emits `.ci/macos-launchd-installer.json`.
5. `scripts/ci/assert-macos-launchd-installer.mjs` requires the exact case to pass once on Darwin.
6. the JSON artifact is retained; OCI/recovery and Deploy cannot proceed without the job.

No GitHub `macos-latest` run has been executed by this Generator. Safe-branch CI readiness therefore requires a terminal run at the final handoff SHA; local native success is not a substitute.

## Explicit non-coverage / release boundary

- The fixture uses a loopback manifest and local Git repository. It does not validate the real release endpoint, release manifest/tag publication, GitHub artifact retention, or production enrollment/backend sync.
- Credentials and a valid queue event are pre-seeded and privacy is paused. Retention is covered; live enrollment, token rotation/revocation, heartbeat delivery, and upload acknowledgement are not.
- Failure injection is a staged release whose `configure` command exits 42. It does not cover power loss, SIGKILL during each cutover instruction, disk-full/permission faults, corrupt plist, failed `launchctl load`, sleep/wake, proxy behavior, or OS upgrade behavior.
- The test validates native launchd in the current GUI user domain. It does not validate headless SSH sessions or a managed runner with no GUI domain; those environments fail closed and need a controlled native runner rather than a mock.
- It does not close the remaining B04 matrix: real Windows Task Scheduler execution (the existing fixture stubs `schtasks`), destructive fault matrix, packaging/signing/notarization, manifest pin/tag publication, or real production installation/upgrade/rollback.
- Production readiness is **NOT_READY**. This candidate is only a Generator slice and still requires safe-branch CI plus an independent external-family Evaluator.
