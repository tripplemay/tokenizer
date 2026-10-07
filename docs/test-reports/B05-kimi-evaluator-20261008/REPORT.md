# B05 release-recovery evidence — independent Kimi evaluator report

- **Evaluator:** fresh, independent Kimi-family evaluator (no prior context from implementation)
- **Date:** 2026-10-08 (UTC evidence timestamps 2026-10-07/08)
- **Candidate (exact):** `8877a592d21305f03cdaea5d874d58a581e910a1` — identical to this clone's checked-out HEAD (`git rev-parse HEAD`), clean tree
- **Verdict:** `PASS_SAFE_BRANCH_CI_ONLY` — **`release_ready: false`**
- **Machine-readable verdict:** `verdict.json` (same directory)

This evaluation is based only on re-fetched GitHub API objects, re-downloaded artifact bytes,
local recomputation, and locally executed tests/negative controls. Generator handoffs and prior
evaluator verdicts were used as pointers, never as proof; every load-bearing claim below was
re-derived independently.

## Scope gates — result per gate

| # | Gate | Result | Basis |
|---|------|--------|-------|
| 1 | GitHub safe-branch CI run 37660385870 on exact SHA | **PASS** (non-main scope) | Re-fetched via `gh` |
| 2 | Linux OCI / recovery rehearsal | **PASS** (synthetic scope, one limitation) | Job log + ledger + canary output |
| 3 | Evidence artifact 11501715741, allowlisted manifest/SHA/ledger | **PASS** | Byte-level re-verification + 6 negative controls |
| 4 | Windows CRLF portability changes | **PASS** | Prior failure reproduced as claim, fix verified on native Windows CI at exact SHA |
| 5 | Main-only provenance (GHCR signed attestation) | **NOT EXERCISED** (design verified; never run) | Job steps all `skipped`; static + unit-test coverage only |
| 6 | Real backup/restore gates (production predecessor, live dump, deploy) | **NOT EXERCISED** | Synthetic mode only; Deploy skipped; production serves an older commit |

## Gate 1 — CI run on exact SHA: PASS

`gh run view 37660385870 --repo tripplemay/tokenizer` (saved: `evidence/run-37660385870.json`):

- workflow `Deploy VPS`, event `workflow_dispatch`, branch `codex/b04-b05-integration-ci-20261008`
- `headSha = 8877a592d21305f03cdaea5d874d58a581e910a1` = candidate = this clone's HEAD
- created 2026-10-07T17:36:32Z, completed 17:46:02Z, **conclusion: success**
- Remote branch tip re-fetched independently: `codex/b04-b05-integration-ci-20261008` = `8877a592…` (`evidence/branch-tip.json`); `main` = `2074991717abaf3cb34d9aad894bcd4357fefbc3` (`evidence/main-tip.json`)

Jobs (`evidence/run-37660385870-jobs.json`):

| Job | Conclusion | Notes |
|---|---|---|
| Verify | success | 129 files / 1694 tests passed, 23 skipped; pinned contract 6/6 |
| Verify (Windows) | success | 127 files / 1656 tests passed, 61 skipped (details under Gate 4) |
| Verify (authenticated browser) | success | |
| Verify (PostgreSQL 16) | success | |
| Linux OCI and recovery rehearsal | success | main-only steps skipped (Gate 5) |
| Deploy | **skipped** (0 steps) | correct for non-main `workflow_dispatch` |

## Gate 2 — Linux OCI / recovery rehearsal: PASS (synthetic, one limitation)

Job log re-fetched (`evidence/oci-rehearsal-step.log`, 315 lines, step "Backup restore migration
and old-image business rehearsal", ubuntu-24.04 runner):

- Environment observed in log: `REHEARSAL_MODE: synthetic`, `EXPECTED_SHA: 8877a592…`,
  digest-pinned images only — candidate `tokenizer-app@sha256:0faf48dc…`,
  `tokenizer-migrate@sha256:d4e78939…`, previous `rollback-app@sha256:dfbe8663…`,
  `rollback-migrate@sha256:74c28275…`, `PREVIOUS_SHA: 2074991717…` on an ephemeral
  `localhost:5000` registry (destroyed with the runner).
- Previous source (`2074991717…`, = current `origin/main` tip, verified ancestor of HEAD, 70
  commits behind) was rebuilt from `git archive` baseline and applied all 28 migrations to a
  scratch PG16 container; canary kept (`enroll-ingest-summary ok eventCount=1 totalTokens=23`).
- Dump → checksum → `pg_restore --exit-on-error` into an isolated PG16 → candidate migrate
  image → inventory unchanged (`restore_inventory=2|2|1|1|23`) → runtime UID `1000` (non-root)
  → candidate app health-checked against exact revision → business canary (23 tokens / 1 event)
  → **old app started against the migrated scratch DB, same canary passed** → rollback gate
  written: `rollback=passed`, `elapsed_seconds=40`.
- Static review of `scripts/test/rehearse-release.sh` confirms fail-closed staging (internal
  Docker network, no host ports, synthetic secrets, `sha256sum -c`, `--exit-on-error`, stale-gate
  removal, cleanup incl. anonymous volumes), `scripts/verify-release-image.sh` enforces
  revision label == expected SHA, `scripts/select-release-predecessor.sh` rejects
  candidate-as-predecessor.

**Limitation (material):** `git diff 2074991717…8877a592… -- prisma/migrations` is **empty**.
The "exact candidate migration image" step logged `28 migrations found … No pending migrations
to apply`. The rehearsal therefore proves dump/restore/inventory/business-canary and
old-app-against-restored-DB compatibility, but **no schema-changing forward migration was
exercised** (none exists in this candidate). A future candidate that adds migrations re-opens
this question.

**Synthetic boundary:** no production data, credentials, registry, or deployment were involved.
`elapsed_seconds=40` is rehearsal duration, not an RPO/RTO SLA.

## Gate 3 — evidence artifact 11501715741: PASS

Re-fetched artifact metadata (`evidence/artifact-11501715741-api.json`): name
`release-recovery-8877a592d21305f03cdaea5d874d58a581e910a1`, 14465 bytes, not expired
(expires 2026-10-21T17:45:33Z — 14-day retention), created by run 37660385870 at the exact SHA.

- **Transport integrity:** downloaded ZIP SHA-256 `4883e760…ca93c0` equals the GitHub
  API-reported digest (`evidence/artifact-downloaded-zip-sha256.txt`).
- **Allowlist:** ZIP contains exactly the 4 allowlisted files + `manifest.json` — synthetic dump
  (PostgreSQL custom format, 65943 bytes, mode 0600), its `.sha256`, `.rehearsal` ledger,
  `.rollback-approved` gate. No `.env`, no `previous-env`, no foreign-SHA files.
- **Manifest:** schema 1, `revision` = exact candidate SHA, `provenanceRequired: false`
  (correct for non-main); all 4 entry hashes recomputed locally and match
  (`evidence/artifact-manifest-hash-recheck.txt`).
- **Ledger consistency:** `commit=8877a592…`, `mode=synthetic`, `backup_file` name matches the
  dump, `rollback=passed`; rollback-approved `previous_sha=2074991717…` = real commit =
  current `origin/main` tip.
- **Independent execution of the repo's verifier against the real downloaded artifact:**
  `node scripts/ci/recovery-evidence.mjs verify <dir> 8877a592… false` → exit 0.
- **Six independent negative controls, all fail closed (exit 1):** tampered dump, tampered
  manifest bytes, wrong revision, extra `.env` file, demanding main provenance from a non-main
  manifest (downgrade refusal), missing `rollback-approved`
  (`evidence/artifact-verify-and-negative-controls.txt`).

## Gate 4 — Windows CRLF portability: PASS

- Claimed failure reproduced as fact: prior run `37659301770` @ `3cce52e` concluded `failure`
  with **only** `Verify (Windows)` failed; its log shows exactly one failed test —
  `tests/evaluator/b05-evidence-retention-round2.test.ts > keeps all nine immutable historical
  evidence entries byte-identical` ("expected null not to be null", the raw-manifest parser
  tripping on CRLF checkout). Linux Verify/PG16/browser passed; OCI and Deploy skipped
  (`evidence/prior-run-37659301770.json`). Run `37660179532` @ `8546afa` was `cancelled`
  (`evidence/prior-run-37660179532.json`). Both match the integration doc's account.
- The fix is `.gitattributes` only (no product code): `…/evidence/** -text`,
  `scripts/test/b05-tcp-readiness-independent.mjs -text`,
  `tests/evaluator/b05-tcp-readiness-independent.test.ts -text`. Verified
  `git check-attr text` = `unset` for all 9 SHA256SUMS payload paths **and** the manifest
  itself (`evidence/git-check-attr.txt`); `-text` materializes bytes exactly as committed —
  the immutable evidence is not weakened or normalized.
- Independent recomputation: `shasum -a 256 -c SHA256SUMS` → **9/9 OK**
  (`evidence/historical-manifest-check.txt`); historical evaluator test hash
  `cd29a182…d5ba0` matches the pinned value.
- Native Windows proof at the exact candidate SHA: run 37660385870 `Verify (Windows)` passed
  with `tests/evaluator/b05-evidence-retention-round2.test.ts` 4/4,
  `tests/ci/recovery-evidence.test.ts` 14 (1 platform-appropriate symlink skip),
  `tests/ci/b05-recovery-source.test.ts` 10/10.
- Locally (macOS, Node v25.7.0, clean `npm ci`): 5 focused files / **44 tests, all pass**
  (`evidence/focused-tests-local.log`).

## Gate 5 — main-only provenance: NOT EXERCISED (design verified only)

- In run 37660385870 the steps `docker/login-action` (GHCR), `Attest app digest`,
  `Attest migration digest`, and `Verify signed provenance and exact source revision` are all
  **skipped** — they are gated `if: github.ref == 'refs/heads/main' && github.event_name !=
  'pull_request'`. The candidate was never pushed to GHCR; no signed attestation exists for it.
- Static design is sound and tested: `PUBLISH` switches registry to GHCR only on main;
  attestation verification pins `--source-digest $GITHUB_SHA` and the exact signer workflow,
  with wrong-source and wrong-workflow negative controls; deploy job independently re-verifies
  provenance before SSH; evidence transport refuses main/non-main manifest downgrade
  (proven locally: `require-prov -> exit=1`).
- This gate can only be closed by a real main-path run. It has never run.

## Gate 6 — real backup/restore and production gates: NOT EXERCISED

- Rehearsal ran in `synthetic` mode only; `REHEARSAL_MODE=live` (real `pg_dump` of the
  production DB, live restore, real migration rehearsal before live migration) has never run.
- `Deploy` was skipped; no VPS activity, no `.releases/<sha>.previous-env` baseline ledger, no
  digest-pinned production predecessor. Production health re-fetched read-only:
  `https://token.vpanel.cc/api/health` → `{"ok":true,"commit":"92d410c6…"}` — production serves
  an older commit, **not** this candidate (`evidence/production-health-20261008.json`).
- Per the runbook, the first digest-based deployment requires an authorized baseline cutover
  that has not happened. Nothing in this candidate's evidence covers production backup
  retention, credential rotation, email delivery, or live login.

## What this proves vs. what it does not

**Proven (synthetic CI scope, exact SHA `8877a592…`):** complete non-main CI is green including
native Windows; the Linux OCI build + isolated backup/restore + no-op-migration + business
canary + old-image compatibility rehearsal executed for real in CI; the recovery evidence was
retained as an immutable, allowlisted, hash-verified artifact whose transport round-trip and
ledger are byte-exact; the CRLF portability defect is fixed without weakening historical
evidence; the workflow statically enforces main-only provenance, deploy gating, and
predecessor selection.

**Not proven:** any main-path behavior (GHCR publish, signed attestations, negative controls
executed for real), any production behavior (live dump/restore, real migration against
production data, deployment, health/business canary, rollback), and any migration with an
actual schema delta. B05 `release_ready` therefore remains **false**. Additionally, per the
runbook, B01 CI prerequisites and B02 dependency/auth hardening must hold at integration —
B02 still carries independent release blockers outside this scope.

## Limitations of this evaluation

1. GitHub-hosted runner integrity is trusted via API-reported metadata/logs; these were
   internally consistent (timestamps, digests, artifact linkage all cross-check).
2. The artifact has 14-day retention (expires 2026-10-21T17:45:33Z); my byte-level findings
   are reproducible only until then (raw copies are preserved under `evidence/`).
3. The prior round-2 candidate `6164b4e…` is not in this clone's object store; claims about
   that different candidate were not re-derived here and were not needed for this verdict.
4. I did not execute `rehearse-release.sh` locally (no Linux Docker daemon on this macOS
   host); its CI execution evidence was re-fetched and its script logic statically audited.
5. Production health check is a public read-only endpoint; it proves only which commit is
   served, nothing about authenticated production behavior.

## Reproducible commands

```bash
# Exact candidate
git rev-parse HEAD   # 8877a592d21305f03cdaea5d874d58a581e910a1

# CI run and jobs
gh run view 37660385870 --repo tripplemay/tokenizer --json headBranch,headSha,event,conclusion
gh api repos/tripplemay/tokenizer/actions/runs/37660385870/jobs
gh run view --repo tripplemay/tokenizer --job 112927749962 --log   # OCI/recovery job
gh run view --repo tripplemay/tokenizer --job 112926444846 --log   # Windows job

# Artifact round-trip and negative controls
gh api repos/tripplemay/tokenizer/actions/artifacts/11501715741
gh api repos/tripplemay/tokenizer/actions/artifacts/11501715741/zip > artifact.zip
shasum -a 256 artifact.zip   # must equal API digest field
unzip -o artifact.zip -d artifact
node scripts/ci/recovery-evidence.mjs verify artifact 8877a592d21305f03cdaea5d874d58a581e910a1 false

# CRLF / immutability
git check-attr text -- docs/test-reports/B05-tcp-readiness-independent-20261007/evidence/SHA256SUMS \
  scripts/test/b05-tcp-readiness-independent.mjs tests/evaluator/b05-tcp-readiness-independent.test.ts
shasum -a 256 -c docs/test-reports/B05-tcp-readiness-independent-20261007/evidence/SHA256SUMS

# Focused local tests
npm ci
npx vitest run tests/ci/recovery-evidence.test.ts tests/ci/b05-recovery-source.test.ts \
  tests/evaluator/b05-evidence-retention-round2.test.ts \
  tests/ci/windows-installer-gate.test.ts tests/ci/windows-agent-owner-gate.test.ts

# Provenance / production state (read-only)
gh api repos/tripplemay/tokenizer/branches/main --jq .commit.sha
curl -fsS https://token.vpanel.cc/api/health
```

## Boundary statement

No product code, tests, docs, state files (`progress.json` / `features.json` / `backlog.json`),
`pending_gate`, or existing evaluator evidence was modified. No branch was pushed. All outputs
are additive under `docs/test-reports/B05-kimi-evaluator-20261008/` only.
