# B04 macOS launchd abnormal-cleanup path correction

Generator-only handoff from exact base `d1d4bb10b80b7a8a61a82e5a3032f26ddddfd37f`. This is not a new Kimi Evaluator verdict or release approval. The original evaluator verdicts, status, gate, manifest, version, installer and product runtime code were not changed. Nothing was pushed.

## Defect and narrow fix

At the base SHA, the native fixture creates its root using `mkdtempSync(join(tmpdir(), "tokenizer-macos-launchd-"))` (`tests/cli/agent-release-installer-macos.test.ts`), while the workflow's abnormal-exit trap accepts only `$RUNNER_TEMP/tokenizer-macos-launchd-*`. Node's `os.tmpdir()` follows `TMPDIR` on macOS; the checkout has no invariant equating that variable with `RUNNER_TEMP`. An isolated simulation with distinct values produced `trapAccepts:false`. A normal fixture run calls `afterEach` and deletes its cleanup record, so passing normal CI does not exercise this fallback trap.

The fix is four workflow lines immediately before the native step's trap: require `RUNNER_TEMP`, canonicalize it with `pwd -P`, set `TMPDIR` to exactly that canonical path, and export both. The existing fixture therefore uses the same trusted base as the trap. This also preserves `src/cli/service.ts`'s separate `resolveLaunchdIdentity` guard, which requires the isolated HOME to be under Node's `tmpdir()`; changing only the fixture root to `RUNNER_TEMP` would have broken that guard.

## Regression mechanism

`tests/ci/macos-launchd-cleanup-trap.test.ts` executes the **actual workflow step shell** under an intentionally different initial `TMPDIR` and `RUNNER_TEMP`. A fake `npx` writes the same cleanup record as the native fixture and exits 42 before any test `afterEach`; fake `launchctl`/`ps`/`xargs` prevent changes to live jobs or processes. It asserts exported `TMPDIR`, Node's actual `os.tmpdir()`, fixture root, trap allowlist, unload call, and removal of root/record. Two negative controls assert that an out-of-scope record is refused and that removing the four-line binding from the step reproduces an orphan after abnormal exit. `tests/ci/macos-launchd-installer-gate.test.ts` pins the workflow binding, trap pattern and fixture `tmpdir()` source together.

These tests do not substitute for native launchd. The existing native fixture was also run on this macOS host (Node `v22.22.0`, usable `gui/501`) with workflow-equivalent canonical `RUNNER_TEMP`/`TMPDIR`: install, upgrade, failed-upgrade restore and offline rollback passed; credential and queue canaries were retained; final scoped processes were zero. That normal run and the synthetic abnormal-exit trap test cover different paths.

## Checks

After a fresh local `npm ci` under Node `v22.22.0` (671 packages):

| Check | Result |
| --- | --- |
| `actionlint .github/workflows/deploy-vps.yml` | pass |
| Abnormal-exit trap + CI gate | 12/12 passed |
| Native macOS launchd fixture with bound temp root | 1/1 passed, zero scoped processes |
| `npm run verify` | pass |
| `npm run lint` | pass |
| Full `npm test` with bound temp root | 133 files passed, 9 skipped; 1713 tests passed, 23 skipped |
| `git diff --check` | pass |

Before the fresh install, a run against the main checkout's symlinked `node_modules` failed typecheck due to missing `@playwright/test` and mismatched Next cache API types; the fresh `npm ci` resolved that environment mismatch. It is not a source regression. No exact-SHA GitHub Actions run, Windows result or production deployment is claimed.

## Replay

```bash
PATH=/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin:$PATH npm ci --no-audit --no-fund
actionlint .github/workflows/deploy-vps.yml
/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin/node node_modules/vitest/vitest.mjs run tests/ci/macos-launchd-cleanup-trap.test.ts tests/ci/macos-launchd-installer-gate.test.ts
FIXTURE_BASE=$(mktemp -d /tmp/tokenizer-b04-native-trap.XXXXXX)
FIXTURE_BASE=$(cd "$FIXTURE_BASE" && pwd -P)
RUNNER_TEMP="$FIXTURE_BASE" TMPDIR="$FIXTURE_BASE" /Users/yixingzhou/.nvm/versions/node/v22.22.0/bin/node node_modules/vitest/vitest.mjs run tests/cli/agent-release-installer-macos.test.ts
PATH=/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin:$PATH npm run verify
PATH=/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin:$PATH npm run lint
RUNNER_TEMP="$FIXTURE_BASE" TMPDIR="$FIXTURE_BASE" PATH=/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin:$PATH npm test
```

The directory is a disposable fixture parent, not production data. GitHub Actions supplies its own `RUNNER_TEMP` and the workflow now performs the canonicalization itself.
