# B05 TCP readiness independent evaluation

Date: 2026-10-07

Candidate: `fff9d3723a5fb34a2e38194f1074210f67669a6b`

Prior composition: `3ade5d1e45ac0f53f0f7a122711e6e219b7dac09`

Immutable post-CI supplement: `11907f5df1bcedc03a5600252056502fd1e88f3f`

## 总体结论

- **TCP first-init recovery fix: PASS.** The candidate changes PostgreSQL readiness from the default Unix socket to `127.0.0.1` TCP. Independent baseline/candidate simulation reproduced the exact shutdown race on `3ade5d1`, then proved success and both bounded fail-closed cases on `fff9d372`.
- **Exact-SHA native workflow: SUCCESS.** GitHub Actions run `37650581332` completed successfully on the exact candidate SHA. Verify, Windows, PostgreSQL 16, authenticated browser, and Linux OCI/recovery all succeeded; Deploy was skipped as required for the non-main branch.
- **CI-only admission: BLOCKED despite the green run.** The mandatory recovery evidence was not retained. The upload step warned `No files were found with the provided path: .releases/. No artifacts will be uploaded.` The run API has no `release-recovery-fff9d372...` artifact.
- **Full B05 release: NOT_READY.** GHCR publication/attestation checks, the real production predecessor/bootstrap baseline, production backup restore, deploy, canary, and rollback remain unexecuted. The VPS guide also still contains mutually contradictory deployment descriptions.
- B04 findings are unrelated and outside this evaluation. They neither invalidate the B05 TCP fix nor become evidence that B05 is complete.

## Findings

### [HIGH] B05-TCP-EVAL-001 - green workflow silently retained no recovery evidence

The live recovery step reached:

```text
backup/restore, exact migrations, runtime UID, and business canary completed; rollback=passed
```

The immediately following artifact step used `path: .releases/` with `include-hidden-files: false`, emitted a warning that no files were found, and still concluded success. The artifacts API returned six unrelated artifacts (four Docker build records, Windows owner evidence, and browser evidence) and no release-recovery artifact.

Impact:

- The backup dump/checksum, rehearsal ledger, and rollback approval produced on the ephemeral runner are not available for independent inspection.
- This violates the immutable post-CI supplement's explicit closure condition to retain the recovery artifacts before integration.
- The default warning behavior makes the overall workflow green while the evidence gate is absent.

Required fix:

1. Upload hidden files explicitly (`include-hidden-files: true`) or copy the bounded evidence to a non-hidden staging directory.
2. Set `if-no-files-found: error`.
3. Rerun the complete workflow on the new exact SHA and confirm the named recovery artifact exists, is downloadable, and contains the expected backup checksum, rehearsal ledger, and rollback approval.

Evidence:

- `evidence/native-run-37650581332-recovery-excerpt.txt`
- `evidence/native-run-37650581332-artifacts.json`
- `.github/workflows/deploy-vps.yml:437-453`

### [MEDIUM] B05-TCP-EVAL-002 - VPS deployment guide remains internally contradictory

The newly updated section correctly says CI builds immutable digest-pinned app/migration images and that source builds are legacy/emergency-only. Earlier in the same `GitHub CI/CD Deployment` section, the guide still says CI does not build the deployment image and that the workflow SSHs to the VPS to build SHA-tagged images there. Both cannot describe the current workflow.

Impact: an operator can follow a stale source-build model and misunderstand provenance, recovery, and release-gate requirements. This does not affect the TCP code path or the non-main workflow result, but it remains a production handoff blocker.

Evidence: `evidence/vps-doc-contradiction.txt` (`docs/VPS-deployment.md:144-150`, `:238-244`).

## TCP recovery verification

The independent probe used the exact script blobs from git with a deterministic Docker command fixture that models the official first-init sequence:

| Case | Result | Decisive observation |
| --- | --- | --- |
| Baseline `3ade5d1` | expected failure, exit 6 | two socket probes returned early; `pg_restore` hit `FATAL: the database system is shutting down`; stale gate removed; cleanup ran |
| Candidate normal path | pass, exit 0 | four TCP probes: first reject then final-server accept for source and restore DB; restore completed; rollback gate written |
| Candidate source TCP never ready | fail closed, exit 1 | 30 TCP probes; no dump/restore; no stale gate; containers/network cleaned |
| Candidate restore TCP never ready | fail closed, exit 1 | source dump completed; restore target made 30 failed probes; no restore/gate; cleanup ran |

Static comparison proves `scripts/test/rehearse-release.sh` differs from the prior composition only by the two explanatory comments and `-h 127.0.0.1`. Backup naming/checksum, cleanup trap, restore, old-image canary, inventory check, and rollback gate ordering are byte-identical.

The native Ubuntu/amd64 job independently confirms the corrected behavior against a fresh `postgres:16-alpine`: the recovery job succeeded in 5m36s and logged `rollback=passed`. This is stronger than the deterministic fixture, but it does not cure the missing retained artifact.

Evidence:

- `evidence/baseline-negative.json`
- `evidence/candidate-tcp-readiness.json`
- `evidence/SHA256SUMS`
- `scripts/test/b05-tcp-readiness-independent.mjs`
- `tests/evaluator/b05-tcp-readiness-independent.test.ts`

## Immutable supplement and prior evidence

- The post-CI supplement JSON in the candidate is byte-identical to commit `11907f5`.
- All eight files in its original `SHA256SUMS` verify successfully.
- The supplement remains authoritative for the failed prior run `37645682850`; this report does not rewrite it. The new exact-SHA run closes its functional TCP-race blocker but not its artifact-retention requirement.

Evidence: `evidence/supplement-integrity.txt`.

## Node 22 and static verification

Environment: macOS 26.6.2 arm64, Node `v22.22.0`, fresh `npm ci` (671 packages). Temporary/cache paths were placed on the external workspace volume.

- Independent focused suite: **6 files, 75 tests passed**.
- Full suite including evaluator tests: **120 files passed, 8 skipped; 1594 tests passed, 22 skipped**.
- `npm run verify`: PASS.
- `npm run lint`: PASS.
- `NEXT_OUTPUT=standalone npm run build`: PASS; standalone boundary verifier PASS.
- `bash -n`, `shellcheck`, and `actionlint`: PASS.
- `npm audit --omit=dev --audit-level=high`: zero production vulnerabilities.
- Local Docker was unavailable (`colima-tokenizer-b05-scratch` socket absent); no local-native Docker claim is made. The exact candidate nevertheless received native Ubuntu/amd64, Windows, PostgreSQL 16, and authenticated-browser execution in GitHub Actions.

## Exact GitHub run result

Run: `37650581332` (`workflow_dispatch`, branch `codex/b05-tcp-readiness-ci-20261007`)

| Job | Exact status |
| --- | --- |
| Verify | `completed/success` |
| Verify (Windows) | `completed/success` |
| Verify (PostgreSQL 16) | `completed/success` |
| Verify (authenticated browser) | `completed/success` |
| Linux OCI and recovery rehearsal | `completed/success` |
| Deploy | `completed/skipped` |

Run conclusion: `completed/success`, updated `2026-10-07T16:23:33Z`.

Evidence: `evidence/native-run-37650581332-final.json`.

## Readiness boundaries

### CI-only readiness

**BLOCKED_PENDING_RECOVERY_ARTIFACT_RETENTION.** Functional jobs are green, including the exact native recovery path, but the workflow did not retain the artifact required by the preceding independent gate. Fixing the upload configuration requires a new SHA and exact-SHA rerun.

### Full B05 release readiness

**NOT_READY.** Remaining hard gates:

1. Retain and independently inspect recovery artifacts from a green exact-SHA run.
2. Execute main-equivalent GHCR publication and signed-attestation positive/wrong-SHA/wrong-workflow checks.
3. Establish and record the actual production retained old-digest/bootstrap baseline.
4. Restore an actual production backup in isolation, then execute authorized production deploy, readiness, business canary, and rollback evidence.
5. Reconcile the contradictory VPS deployment documentation.

### B04 boundary

B04 supply-chain/agent-release gates are not part of the B05 candidate or this verdict. They must be tracked separately for an aggregate release and are not counted as a B05 defect.
