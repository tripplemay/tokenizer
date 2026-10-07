# B05 recovery-evidence retention Generator handoff

Date: 2026-10-07. Role: Generator self-test, not independent acceptance.

## Scope and provenance

- Exact detached base: `fff9d3723a5fb34a2e38194f1074210f67669a6b` (B05 TCP candidate, not B04/B06).
- Worktree: `/Volumes/ORICO/project/.worktrees/tokenizer-b05-evidence-retention-fix-20261007`.
- Independent supplement `e550e27c6882f0ff76839545fe36a4cfd7fa7966` transported cleanly as `d18c4ff` with directory-rename inference disabled. Its report/verdict/evidence paths and bytes are unchanged; the original manifest verifies (`evidence/transport-hashes.log`).
- The commit containing this handoff is the new Generator candidate; obtain its exact SHA with `git log -1 --format=%H` after checkout.
- No push, state/gate edit, deployment, production backup read, Agent/tag publication, or self-evaluator verdict occurred. B06 is left at its separate clean checkpoint `c15ac2d4456eb13c978936bfddaa92314baabc80`, without product implementation.

The independent supplement records [run 37650581332](https://github.com/tripplemay/tokenizer/actions/runs/37650581332): native verification and Linux OCI recovery passed, but upload-artifact warned that no `.releases/` files were found and no required release-recovery artifact exists. Its overall conclusion remains **BLOCKED**. A green job without retained evidence is not an accepted recovery gate.

## Production workflow repair

The Linux `release-artifact` job now pins Node22 and explicitly sets `REHEARSAL_MODE: synthetic`. It stages a strict exact-SHA allowlist under a non-hidden upload directory, instead of uploading arbitrary `.releases/` contents. Upload uses `include-hidden-files: true` and `if-no-files-found: error`. In the **same job**, `actions/download-artifact@v4` downloads that named artifact to a different directory and the new checker verifies the actual downloaded manifest, file list, SHA and hashes. Missing upload/download/checker evidence makes that job fail and continues to block the existing dependent deploy job.

`scripts/ci/recovery-evidence.mjs` has two commands:

```
node scripts/ci/recovery-evidence.mjs stage SOURCE_DIR EXACT_SHA REQUIRE_PROVENANCE OUTPUT_DIR
node scripts/ci/recovery-evidence.mjs verify DOWNLOADED_DIR EXACT_SHA REQUIRE_PROVENANCE
```

`REQUIRE_PROVENANCE` is exactly `true` for the authorized main publication path and `false` for non-main evaluation. Main and non-main manifests cannot be downgraded/interchanged. This integrity checker does not replace the workflow's signed-provenance verification.

The required synthetic allowlist is:

- One `${SHA}.tokenizer-rehearsal-${PID}-${RANDOM}.backup.dump` and its original `.sha256` sidecar.
- `${SHA}.rehearsal`: matching commit/dump path, `mode=synthetic`, non-root runtime UID, numeric inventory, and `rollback=passed`.
- `${SHA}.rollback-approved`: the digest-pinned previous app and previous source SHA.
- Main only: exact-SHA app/migrate provenance JSON and both negative-control ledgers.
- Generated `manifest.json`: exact revision, provenance requirement, sorted allowed filenames, sizes and SHA256 hashes.

Unknown `.releases` files, `.env`, previous-env files, live/other-revision backups, and provenance files not required by a non-main run are not copied. Missing, empty, ambiguous, invalid-checksum, unapproved or live-mode evidence fails before staging. Sources/downloads must be regular non-symlink files in a non-symlink directory. Verification rejects extra or missing files, wrong revision, manifest path traversal, altered hashes/content, and main/non-main requirement mismatch. The dump is bounded at 64 MiB and each other file at 1 MiB. This is specifically a CI synthetic artifact path: the rehearsal continues to use isolated containers, synthetic auth/mail and canary data; no production dump is admitted by this workflow. The rehearsal/TCP/restore/rollback scripts and app/database code are unchanged.

## Documentation and test-expectation changes

The GitHub CI/CD overview in `docs/VPS-deployment.md` now agrees with the existing immutable-digest description: CI-built app/migrate artifacts, separate main GHCR/provenance and non-main registry behavior, mandatory recovery plus downloaded evidence, retained previous digest/config, no VPS app rebuild, and separately authorized real production baseline/restore prerequisites. It does not promise automatic database rollback.

The transported active evaluator test had asserted the old documentation contradiction **exists**. Only that active regression's name and two assertions were updated to require the contradiction's absence; its immutable supplement comparison, readiness delta, and backup/cleanup/rollback invariants remain. Original evaluator report/verdict/evidence and transport commit stay unchanged. Coordinator explicitly approved this obsolete-test expectation update; it is not a new evaluator signoff.

## Generator validation and retained negatives

Runtime: macOS arm64, Node `v22.22.0`, own `npm ci`; commands use Node22 PATH and `TMPDIR=/Volumes/ORICO/project/.b05evidencetmp`. No unrelated agent/user directories were cleaned. Standard full tests ran without this task's build overlapping. Build database/auth values were synthetic.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Recovery-evidence focused suite | 14 passed, exit 0 | `focused-retention.log` |
| Old upload path/defaults and stale doc claim mutants | Expected 2 failed / 12 skipped, exit 1 | `old-upload-doc-mutants-negative.log` |
| Five-file release/evidence/independent-invariant focused run | 44 passed, exit 0 | `focused-final.log` |
| Standard `npm test` | 1608 passed / 22 skipped; 121 files passed / 8 skipped, exit 0 | `full-final.log` |
| `npm run verify` | Exit 0 | `verify.log` |
| `npm run lint` | Exit 0 | `lint.log` |
| Standard `npm run build` | Exit 0 | `build.log` |
| `actionlint` | Exit 0 | `actionlint.log` |
| `node --check scripts/ci/recovery-evidence.mjs` | Exit 0 | `script-syntax.log` |

The new tests exercise allowlist-only output with secret canaries excluded, synthetic filesystem-copy round-trip, missing required files, live/unapproved ledgers, ambiguous backups, incorrect checksum, tampering, extras, wrong SHA, traversal/hash forgery, file/directory symlinks, separate main provenance requirements, and mandatory same-job Actions upload/download/check steps. Symlink tests are POSIX-specific and skip on Windows; the native Linux release job is their target. Other tests are portable. The local round-trip is only a filesystem copy, **not** a GitHub artifact service run.

Development failures are preserved: `development-test-syntax-error.log` records a corrected test literal typo before collection. Before the stale active assertion was updated, focused was 43 passed / 1 old-defect-assertion failure and full was 1607 passed / 1 old-defect-assertion failure / 22 skipped (`focused-old-defect-assertion.log`, `full-old-defect-assertion.log`). The final checks above were rerun after that explicit expectation update; no timeout, skip, retry or product gate was weakened.

## Next owner and remaining blockers

- Candidate exact-SHA native workflow/artifact round-trip: **NOT_RUN**. Coordinator must push a non-main evaluation branch, rerun all native jobs, require the upload/download/checker steps to execute successfully, and inspect the named artifact API entry and downloaded manifest/files. A fresh independent Evaluator is required.
- Independent inspection can download `release-recovery-${SHA}` from that exact run, then run `node scripts/ci/recovery-evidence.mjs verify DOWNLOAD_DIR SHA false` for non-main (or `true` on the authorized main path). Hash validation provides content integrity, not cryptographic source authentication or production backup acceptance.
- Main GHCR publication/attestations, actual production old-digest/bootstrap baseline, authorized production backup restore/deploy/canary/rollback remain separate hard gates. B04 blockers are unrelated. This is a CI-only repair candidate, not release-ready and not evidence that the old run retained its missing artifact.

Own raw evidence is covered by `evidence/SHA256SUMS`, verified from that directory. Independent native-failure evidence retains its original manifest and paths.
