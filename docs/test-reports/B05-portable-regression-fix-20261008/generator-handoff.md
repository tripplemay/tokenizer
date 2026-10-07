# B05 portable-regression Generator handoff

Date: 2026-10-08. Role: Generator self-test, not independent acceptance.

## Scope and correction of the prior handoff

- Detached base: `ec3348ecae2669c68187b7ca35dc6707a20267a8`.
- Worktree: `/Volumes/ORICO/project/.worktrees/tokenizer-b05-portable-regression-fix-20261008`.
- Tested code commit: `8d646d8194074cbb0ed81807b782706ab59b5332`; the following handoff/evidence-only commit does not change its code/test/config blobs.
- No production app, database, installer, recovery script, workflow or deployment documentation changes. No push, state/gate edit, production operation, publication or self-evaluator verdict.
- B06 remains baseline-only in its separate checkpoint `c497248`; it was not mixed into this work.

The prior candidate failed [native run 37653910013](https://github.com/tripplemay/tokenizer/actions/runs/37653910013): active historical audit tests depended on Git objects unavailable in fresh Linux/Windows checkouts. This run failed before the OCI evidence-retention path was exercised. `native-ci-failed-run.json` and `native-ci-failure.log` preserve independently fetched run evidence.

**Correction:** the previous Generator's active-test expectation update modified a file covered by the independent immutable SHA256SUMS. Its earlier `transport-hashes.log` was therefore stale and did not establish final-candidate integrity. `baseline-manifest-failure.log` now explicitly records that failure. The old test has been restored byte-for-byte to the original evaluator blob; the original report, verdict, manifest, evidence, and audit script are not modified. All original 9 manifest entries pass again in both this worktree and the independent full-history checkout (`restored-manifest.log`, `cleanroom-full-manifest.log`). Path-scoped comparisons against `e550e27c6882f0ff76839545fe36a4cfd7fa7966` are empty.

## Narrow archival boundary and portable replacement

`vitest.config.ts` excludes **only** `tests/evaluator/b05-tcp-readiness-independent.test.ts`, retaining the default excludes. This exact historical audit asserts an old documentation defect and references local-only Git objects; it remains an unchanged historical artifact, not a current acceptance test. No evaluator directory or broader platform suite is excluded.

`tests/ci/b05-recovery-source.test.ts` and its candidate-owned helper replace and strengthen those three source checks with ten active tests. They read committed files only and never execute Git or require historical object availability:

- Normalize only CRLF to LF, remove the two readiness comments and TCP host addition, then require the exact original script SHA256 `2d4dfe745469ab8992a4f2b5922cbfed04f9f11b98229bffadb6badcd02eeb5c`. The TCP target must still be present; all original backup, cleanup, restore and rollback-order strings must remain.
- Require the immutable post-CI supplement's LF SHA256 `0197d65339eb73ad5d1b6a9e5e2c13e2f900535a887d51832096af602f3f00e4`.
- Require current immutable-CI/VPS documentation and reject both former VPS-build contradiction strings.
- Require the unchanged archived audit's LF SHA256 `cd29a182483084db6135c97f8c0a6644758a4e86c6a37d7d776243f8c81d5ba0` and the exact narrow configuration exclusion.

The fixed hashes were computed from the original local Git blob and immutable supplement before the isolated clone runs. They do not identify the currently deployed production predecessor or image digest. Actual production baseline/digest remains unverified and outside this task.

Negative controls reject in-memory mutations of temporary-socket readiness, stale rollback approval removal, backup checksum validation, restore fail-closed options, rollback ledger assignment, and temporary-dump cleanup. Changed supplement result/content and reintroduced documentation drift are rejected. The existing 14 recovery-artifact tests remain active, including actual ledger/checksum/path/symlink/extra-file rejection. Thus archival exclusion does not remove the source, ledger, documentation, or evidence-retention coverage.

## Independent checkout simulations

Two separate repositories were initialized and fetched via `file://` transport from the tested code commit, without shared object alternates or node_modules. Each ran its own `npm ci` under Node22.

| Checkout | Historical object availability | Observed result |
| --- | --- | --- |
| Full-history fetch, LF checkout (fetch-depth 0 model) | Original source ancestor `3ade5d1` present; non-reachable `11907f5` absent | Old supplement `git show` exits 128; new focused 36 tests pass; standard full 1615 pass / 22 skip |
| Depth 1 fetch, actual `core.autocrlf=true` CRLF checkout (Windows checkout model) | Both `3ade5d1` and `11907f5` absent | Old source `git show` exits 128; portable plus artifact-focused 24 tests pass |

`cleanroom-checkouts.json` records commit, shallow status, missing objects and real CRLF presence. Both repositories are clean after execution. These processes ran on **macOS arm64**, not native Linux or Windows. LF/CRLF and shallow/full-history models test checkout portability, not Windows process/filesystem/PowerShell acceptance. Raw immutable manifests are verified on the LF checkout; portable source hashes canonicalize only checkout line endings, not arbitrary whitespace or content.

## Generator results

Environment: Node `v22.22.0`; own npm installs; TMPDIR `/Volumes/ORICO/project/.b05portabletmp`. Standard full tests ran before this task's build, without overlapping build/stress. Build database/auth values were synthetic. No unrelated directories were cleaned.

| Check | Result | Evidence |
| --- | --- | --- |
| Prior candidate immutable manifest | Expected exit 1; only modified historical test fails | `baseline-manifest-failure.log` |
| Restored immutable manifest | 9/9 pass, exit 0 | `restored-manifest.log`, `cleanroom-full-manifest.log` |
| Prior local-object dependency in clean checkouts | Expected exit 128 for missing object | `cleanroom-full-old-object-negative.log`, `cleanroom-shallow-old-object-negative.log` |
| New portable positives and mutation negatives | 10 pass, exit 0 | `portable-mutation-tests.log` |
| Candidate focused run | 36 pass, exit 0 | `focused-final.log` |
| Full-history fresh focused run | 36 pass, exit 0 | `cleanroom-full-focused.log` |
| Shallow CRLF fresh focused run | 24 pass, exit 0 | `cleanroom-shallow-crlf-focused.log` |
| Standard `npm test` in fresh full-history checkout | 1615 pass / 22 skip; 121 files pass / 8 skip, exit 0 | `cleanroom-full-suite.log` |
| `npm run verify` | Exit 0 | `verify.log` |
| `npm run lint` | Exit 0 | `lint.log` |
| Standard `npm run build` | Exit 0 | `build.log` |
| `actionlint` | Exit 0 | `actionlint.log` |

## Next owner and remaining gates

Candidate native GitHub Linux/Windows/full OCI/artifact round-trip is **NOT_RUN**. Coordinator must push the final handoff SHA to a non-main evaluation branch, rerun the exact native workflow, require the actual upload/download/hash verification to execute and retain the named artifact, then obtain fresh independent evaluation. Local test success does not override the previous red run or establish the previously missing recovery artifact.

Main-only publication/attestations, real retained production digest/bootstrap/backup restore/deploy/canary/rollback, and unrelated B04 release blockers remain separate. This is a test-portability candidate, not a merge/deployment/release verdict.

Own evidence is covered by `evidence/SHA256SUMS`, verified from that directory. The original independent manifest and artifacts remain untouched and valid after the source restoration.
