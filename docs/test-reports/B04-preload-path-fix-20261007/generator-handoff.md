# B04 Windows preload-path Generator handoff

Date: 2026-10-07. Role: Generator self-test, not independent acceptance.

## Candidate and preserved evidence

- Detached worktree: `/Volumes/ORICO/project/.worktrees/tokenizer-b04-preload-path-fix-20261007`.
- Exact base: `62dba5a77333816d614dcf5f61476f2bf2cc4dd4` (B04 candidate, not B05).
- Independent round-three commit `8acf5ba28739cb647abccb2344c37361f54bedc9` transported unchanged as `3c05399`; directory-rename inference was disabled. Original report/verdict/evidence paths and bytes match the source commit, and its SHA256SUMS passes (`evidence/transport-hashes.log`).
- The commit containing this handoff is the new Generator candidate. Obtain its full SHA with `git log -1 --format=%H` after checkout.
- No push, state/gate edit, Agent publication, tag, production operation, or self-evaluator verdict was made. No B05 change is included.

The independent verdict remains `BLOCK` and is not overridden by this handoff. Its original native evidence records [GitHub run 37647920920](https://github.com/tripplemay/tokenizer/actions/runs/37647920920) on the exact base: Linux, PostgreSQL, and authenticated browser jobs passed; Windows failed its mandatory installer fixture 1/1. The subsequent Windows full suite, owner gate, and PowerShell parser were skipped. The test-injected `NODE_OPTIONS` raw Windows path lost its backslashes and raised `MODULE_NOT_FOUND` before production cutover or configure/enroll/rollback assertions executed. This evidence does not establish an installer product defect.

## Minimal fixture-only change

`tests/fixtures/agent-release-node-options.ts` shares a test-only encoder that normalizes path separators to `/` before enclosing the preload path in double quotes for `NODE_OPTIONS`. Quotes retain spaces; removing backslash escapes retains the intended Windows path through Node's option parser. Both the native PowerShell installer fixture and portable real-Node configure/enroll fixture use this encoder.

The native fixture still copies the actual `node.exe`, uses the existing CJS preload interception, and deliberately creates `tokenizer win-release-*` and `fake bin` directories with spaces. All nonzero failure, configure-42/enroll-55 trace, old-release service-call restoration, rollback HEAD, queue/credential canary, enrollment-token redaction, concurrency, and lock assertions are unchanged. The portable configure/enroll fixture now also copies its preload into a directory with spaces and keeps its real Node argv, nonzero exit, trace, and secret-redaction assertions.

No production `public/install.ps1`, `public/install.sh`, `src/cli`, manifest, workflow, or exact Windows JSON-result gate was changed. The gate continues to require the existing Windows-only installer assertion to be passed, not skipped.

## Regression and negative control

The added portable test invokes the real Node executable twice with an intentionally missing synthetic Windows preload path containing spaces. With legacy raw quoted backslashes, Node reports the exact separator-stripped module request. With the shared encoder, the same parser reports the slash-preserving module request. Both failures are expected `MODULE_NOT_FOUND` negative probes, not attempts to run the installer or read local secrets.

Temporarily restoring the old raw quoting implementation in the shared encoder makes the new regression fail: 1 failed / 2 skipped, exit 1 (`legacy-negative.log`). Restoring normalization passes the regression and both real preload tests: 3 passed, exit 0 (`focused-preload.log`). This is a macOS Node22 parser and space-path preload reproduction, not native Windows filesystem or PowerShell acceptance.

## Generator validation

Runtime: macOS arm64, Node `v22.22.0`, own `npm ci`; `PATH=/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin:$PATH` and `TMPDIR=/Volumes/ORICO/project/.b04preloadtmp`. Test temporary files remain on ORICO; no unrelated agent/user directory was cleaned. Standard full tests did not overlap this task's build. Build-only database/auth values were synthetic.

| Command/check | Observed result | Own evidence |
| --- | --- | --- |
| Legacy encoder negative regression | Expected exit 1; 1 failed / 2 skipped | `legacy-negative.log` |
| Preload parser and real-Node failure fixture | Exit 0; 3 passed | `focused-preload.log` |
| Eight-file installer/release/CI-gate focused run | Exit 0; 26 passed / 1 native Windows skipped | `focused-final.log` |
| Standard `npm test` | Exit 0; 1543 passed / 23 skipped; 118 files passed / 9 skipped | `full-final.log` |
| `npm run verify` | Exit 0 | `verify.log` |
| `npm run lint` | Exit 0 | `lint.log` |
| Standard `npm run build` | Exit 0 | `build.log` |
| `actionlint` | Exit 0 | `actionlint.log` |

Focused files: `agent-release-installer.test.ts`, `agent-release-installer-windows.test.ts`, `agent-release-installer-windows-fixture.test.ts`, shared release version/i18n tests, server release-route tests, Windows installer gate tests, and POSIX install-agent-lifecycle tests. Full logs preserve the native Windows skips rather than presenting them as acceptance.

## Required next gates

- Candidate native Windows CI is **NOT_RUN**. Coordinator must push this exact candidate to a non-main evaluation branch and rerun the complete workflow. The dedicated Windows fixture, full Windows suite (including the new path regression), owner-force-termination gate, and PowerShell syntax validation must all execute and pass; local macOS results cannot replace them.
- A fresh independent Evaluator is required. This is a CI-only repair candidate ready for that rerun, not a merge/release verdict.
- Manifest/version pin and immutable Agent tag, macOS launchd, real Windows Task Scheduler, and the independent verdict's remaining cross-platform failure/cutover matrix still block release. The fixture's `schtasks`/install-service traces remain stubs, not Task Scheduler behavior.
- The previous native run stays failed. This handoff does not claim the new candidate's CI passed or authorize deployment/publication.

Own evidence is covered by `evidence/SHA256SUMS` (verify from that directory); transported independent evidence retains its original root-relative manifest and native failure logs.
