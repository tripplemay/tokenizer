# B04 macOS launchd Generator round 2 CI portability handoff

This is a Generator handoff for a test-only portability correction. It is not an evaluator verdict or release approval. The original round-1 report remains unchanged.

## Input failure

- Safe-branch run: `37665390447`
- Tested SHA: `c178b45107dc8b3b6053a775caf9d6564b262298`
- Live GitHub API observation during this handoff: run still `in_progress`; Verify, PostgreSQL 16, and native macOS launchd jobs succeeded; Windows failed; authenticated browser was still running.
- Windows failure supplied by the coordinator: only `tests/cli/service-launchd.test.ts:8` failed because the test expected a hard-coded POSIX `/Users/example/...` path while Windows `path.join()` returned backslashes. The same job reported 1670 passing and 62 skipped tests otherwise.
- Native macOS artifact `11502323294` was independently downloaded from the run. `scripts/ci/assert-macos-launchd-installer.mjs` accepted its `macos-launchd-installer.json` with exit 0.

## Minimal correction

- Fix commit: `18ee2697bd7fae569a26549ce55c2e23b520fbed`
- Changed only `tests/cli/service-launchd.test.ts`.
- The test now constructs both the sample home and expected plist with `node:path.join()` and `tmpdir()`, matching the product function's platform-native path semantics.
- No product code, workflow, threshold, timeout, skip, manifest, version, tag, state, gate, or prior report changed.

## Local verification

Environment: macOS 26.6.2 arm64, Node v22.22.0.

- Focused launchd identity and CI gate tests: 15/15 passed, 0 skipped.
- `npm run verify`: passed.
- `npm run lint`: passed.
- `git diff --check`: passed.
- Full Vitest suite: 132 files passed, 9 skipped; 1710 tests passed, 23 skipped.
- The full suite re-executed the native launchd fixture: install, upgrade, failure restore, offline rollback, credential/queue retention, and zero scoped processes after unload all passed.

## Handoff boundary

- The portability fix has not run on Windows CI. A new non-main run at the final handoff SHA is required.
- The prior run's macOS success and retained artifact remain evidence for `c178b45`, not proof for the new SHA.
- No tests were skipped and no acceptance threshold was relaxed.
- Production readiness remains **NOT_READY** for the broader B04 reasons recorded in round 1. This change only removes a platform-specific test assertion defect.
