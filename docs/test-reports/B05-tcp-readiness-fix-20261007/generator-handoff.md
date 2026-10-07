# B05 final-TCP readiness Generator handoff

Date: 2026-10-07. Role: Generator self-test, not independent acceptance.

## Scope and candidate

- Detached worktree: `/Volumes/ORICO/project/.worktrees/tokenizer-b05-tcp-readiness-fix-20261007`.
- Exact integration base: `3ade5d1e45ac0f53f0f7a122711e6e219b7dac09`.
- This slice fixes only the first-init PostgreSQL readiness race in the OCI recovery rehearsal and the stale deployment documentation. No B04 follow-up is included. No push, state/gate change, production operation, or release-readiness claim was made.
- The code commit containing this handoff is the candidate identifier; use `git log -1 --format=%H` after checkout. Transport-only commits precede it.

## Failure evidence and minimal change

The baseline [native GitHub run 37645682850](https://github.com/tripplemay/tokenizer/actions/runs/37645682850), for the base SHA above, passed all four prerequisite verification jobs but failed Linux OCI/recovery at `pg_restore` with PostgreSQL shutting down. Deploy was skipped. `evidence/native-ci-baseline-run.json` preserves the independently fetched job statuses; the transported independent supplement retains the native failure logs and official-image entrypoint evidence.

The PostgreSQL official-image initialization server accepts only Unix-socket connections before it is stopped and the final server starts. The previous probe omitted a host and could accept that temporary server. `start_db` now calls `pg_isready -h 127.0.0.1 -U tokenizer -d tokenizer` for both source and restore databases. The host option selects the TCP endpoint rather than the default local socket ([PostgreSQL 16 pg_isready documentation](https://www.postgresql.org/docs/16/app-pg-isready.html)). Retry count, delay, failure exit, cleanup, restore, migration, rollback approval, and downstream release gates are unchanged.

The deterministic Docker-command fixture models socket success during first-init, first-TCP-probe rejection, and final-TCP readiness separately for each database. It rejects restore before the target's final-server marker. Two never-ready cases verify nonzero exit, stale rollback-approval removal, no `pg_restore`, and scratch-container/network cleanup; the restore-target case also verifies the source backup had run.

The exact original script blob `017abe5d5a1e847444c2b70d4fe68d0b6f6c91f3`, with the final corrected test fixture, fails all three new regressions (3 failed, 9 skipped, exit 1). Its hash is captured in `baseline-script-blob.log`; `baseline-final-model-negative.log` is the authoritative baseline negative control. The final script blob is `d6d6f6bd936fc664106f467fcba326b091989e2f`. No sleep extension, skip, or timeout increase was introduced.

`docs/VPS-deployment.md` now describes CI-built immutable app/migration digests and the main-only GHCR/provenance path, distinguishes the non-main rehearsal, and labels manual source builds as separately authorized legacy/emergency operations rather than the normal deployment workflow.

## Unchanged independent artifact transport

Directory-rename inference was disabled for the successful cherry-picks (`git -c merge.directoryRenames=false cherry-pick ...`). An initial own transport attempt was aborted because that inference moved evidence into an unrelated directory; no such relocation remains.

| Source | Local transport commit | Content |
| --- | --- | --- |
| `df3660ebb563ae68a0d32254c5d8ccce8374a9e8` | `81dfcc19f886daf5477aefba744d063a872454cd` | Original execution logs |
| `11907f5df1bcedc03a5600252056502fd1e88f3f` | `2faad2ca364e06e5c147cea4558e735cc81f86f4` | Post-CI supplement and evidence |
| Exact `df3660e` snapshot | `5164a63e6652f3a60078fe0264efd19a21ff1f56` | Original verdict, absent from that delta's parent in this base |
| Exact `df3660e` snapshot | `5f6c006bea1b8a9c0b8aa0c3c445177e22220da4` | Original evidence metadata, also absent from the delta |

Original paths and bytes are preserved, not manually rewritten. Path-scoped diffs against both source commits were empty; both provided root-relative evidence hash manifests passed (`transport-original-hashes.log`, `transport-supplement-hashes.log`). The original verdict is not a new candidate verdict: its post-CI supplement records CI_BLOCKED and the old red run remains red.

## Generator validation

Environment: macOS arm64, Node `v22.22.0`, Vitest `2.1.9`, Next `16.4.0`; own `npm ci`. Commands use `PATH=/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin:$PATH` and `TMPDIR=/Volumes/ORICO/project/.b05tmp`. Full tests ran without overlapping local build/stress work. Build-only database/auth values were synthetic; no real database was contacted.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Exact baseline script, final first-init model | Expected failure: 3 failed / 9 skipped, exit 1 | `baseline-final-model-negative.log` |
| Final rehearsal file | 12 passed / 0 skipped, exit 0 | `focused-readiness-fixed.log` |
| Five release/deployment focused files | 72 passed / 0 skipped, exit 0 | `focused-final.log` |
| Standard `npm test` | 1591 passed / 22 skipped; 119 files passed / 8 skipped, exit 0 | `full-final.log` |
| `npm run verify` | Exit 0 | `verify.log` |
| `npm run lint` | Exit 0 | `lint.log` |
| Standard `npm run build` | Exit 0 | `build.log` |
| `NEXT_OUTPUT=standalone npm run build` | Exit 0 | `build-standalone.log` |
| `node scripts/verify-standalone.mjs .next/standalone` after standalone build | Exit 0; clean standalone artifact | `standalone-gate.log` |
| `actionlint` | Exit 0 | `actionlint.log` |
| `shellcheck scripts/test/rehearse-release.sh` | Exit 0 | `shellcheck.log` |
| `bash -n scripts/test/rehearse-release.sh` | Exit 0 | Direct command observation |

Failures are retained, not silently overwritten: `baseline-first-init-negative.log` is the early baseline run; `focused-development-model-error.log` and `full-development-model-error.log` recorded a development fixture bug that treated `docker exec -i`'s `-i` as the container name. The fixture was corrected to parse that argument, then the authoritative exact-baseline negative control and all final checks above were rerun. The development full run had 1590 passed / 1 fixture-model failure / 22 skipped. `standalone-gate-without-output-flag.log` records the expected missing artifact when running the gate after a standard build without `NEXT_OUTPUT=standalone`; the subsequent build matches the Dockerfile's standalone output mode and passes the gate.

## Remaining gates and next owner

- Candidate native Linux OCI/PostgreSQL first-init/recovery: **NOT_RUN**. The configured local Docker context's Colima socket is unavailable (`docker-local-unavailable.log`). The deterministic fixture is not a real container run and macOS checks are not native Linux/Windows CI.
- Coordinator must push this exact candidate to a non-main evaluation branch and rerun the complete native workflow, including OCI recovery, before treating the CI blocker as resolved. A fresh independent Evaluator is still required; this document is not its verdict.
- Main-only GHCR publication and attestations, actual production legacy baseline/bootstrap approval, backup restore, and real rollback remain separate release gates. Passing mocked/local checks does not establish them or authorize deployment.

All own raw evidence files are covered by `evidence/SHA256SUMS` (run `shasum -a 256 -c SHA256SUMS` from that directory). Original independent artifacts retain their own manifests and paths.
