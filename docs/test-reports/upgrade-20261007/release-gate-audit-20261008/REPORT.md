# Release gate audit (2026-10-08)

Scope: read-only technical audit of the proposed upgrade release path. This is
not an independent cross-family Evaluator verdict or production signoff. The
source tree was not changed; observations are pinned in `evidence.json`.

## Decision

**Do not push `main` yet.** At audit time, repository `main` and `origin/main`
were `2074991717abaf3cb34d9aad894bcd4357fefbc3`; the public health endpoint
still reported production commit `92d410c6d0bd7fbb9ca4bdb0d984936c0a1db2a1`.
The integration tree was a non-main candidate. Its successful six-job run
`37673679082` at `8d5583715a915dbfbc340be27cd872c9ff66526e` had
`Deploy=skipped`; the retained recovery artifact was **synthetic**, with no
main-only GHCR attestation or production backup/restore evidence. That run did
not include the later B03 replay/B07 client combination. The combination run
`37675079483` at `116a1fffb2bd8c800f721adf1cd99653981da2df` failed its
Windows full suite, and its independent technical prereview found a P1 CLI
deadline overrun. A successor must pass exact-SHA native CI and cross-family
evaluation before integration.

## Release-critical path

1. **Freeze scope and exact SHA.** Keep the old `BL-HOMEPAGE-FRESHNESS` state
   separate: `progress.json.status=verifying`, F005 is `pending`, and
   `pending_gate=null`. A narrowly scoped hotfix may be released through an
   explicitly separate path while F005 remains pending; it must not be labeled
   F005 signoff or a completed M0-M3/G1 upgrade. Do not write
   `pending_gate.decision`.
2. **Close candidate correctness gates.** Resolve B03/B07 combination's Windows
   timeout and unbounded startup Git subprocess behavior, then run Node 22
   clean install, lint, verify, full tests, build, all six native/DB/browser/OCI
   jobs at the *final composed SHA*, and a fresh cross-family Evaluator. Keep
   B02's exact vendor/lock/override bytes and independent backport evidence
   pinned; a dependency change invalidates the existing scoped advisory
   disposition. A green earlier or narrower SHA cannot be substituted.
3. **Establish the production predecessor before the first digest deployment.**
   `scripts/deploy-vps-release.sh` intentionally refuses replacement of a
   running app unless `.releases/<candidate-sha>.previous-env` contains
   digest-pinned old app and migrate images and the current app container's
   image ID equals the image ID behind that old digest. The documented legacy
   local-build production install does not meet this automatically. Per
   `docs/B05-release-runbook.md` lines 69-77, first build/attest the exact
   predecessor source as a portable image, back up the live DB, restore to an
   isolated scratch database, rehearse the migration and old-image business
   path, and perform a separately authorized, observed old-version digest
   baseline cutover. Capture old SHA/digests, container ID, restricted previous
   config, dump checksum, restore inventory, and observed health/canary. Do not
   fabricate `.previous-env`, treat a same-source rebuild as the running image,
   restore over the active volume, or describe a synthetic CI dump as a
   production recovery point. The present non-main `bootstrap_rehearsal` only
   exercises a non-deploying/synthetic path; this repository does not currently
   provide a one-command non-main baseline cutover.
4. **Complete deployment preflight before any main push.** The repository
   Actions secret-name list lacked `POSTGRES_PASSWORD` at audit time. The new
   `scripts/validate-deploy-secrets.sh` requires it, and its value must match
   the *existing* PostgreSQL role password; adding the secret does not rotate
   the role. An operator with repository/production access must set it in
   GitHub Secrets without sending the value in chat, verify the other required
   settings, GHCR/attestation permissions, VPS platform/Compose support, backup
   retention and the maintenance window. The `production` GitHub environment
   had no protection rules, so a `main` push will not pause for an environment
   reviewer. `CLAUDE.md` line 19 says deployment is manually triggered, but
   its line 64 and the live workflow `on.push.branches: [main]` establish the
   operative rule: **push main triggers production**.
5. **Release and verify independently.** Only the coordinator may transport
   the reviewed diff and push `main`. The main run must complete all prerequisite
   jobs, publish and verify exact-source/exact-workflow signed GHCR app and
   migrate digests including negative controls, retain and re-download the
   hash-checked recovery artifact with provenance required, perform a real
   live-dump-to-isolated-restore rehearsal, and finish `Deploy=success`.
   Independently inspect activated digest/SHA ledger, `/api/health/live`,
   `/api/health`, `/api/health/capabilities`, enroll-ingest-summary, and
   authenticated browser behavior. F005 specifically needs the user-provided
   signed-in test tab and at least 65 seconds/two polling cycles showing new
   events without hard refresh; a synthetic CI browser test is not a substitute.
   A failed post-deploy business/browser check requires an explicit containment
   or rollback decision and preserves F005 as pending.

User/operator inputs still needed: (a) an operator sets the existing database
role password as the `POSTGRES_PASSWORD` Actions secret and confirms the
separately authorized predecessor-baseline maintenance window and backup
destination; (b) the user identifies the already signed-in test browser tab for
F005. Neither password nor session token should be sent through chat.

## Deferrable, only with an explicit narrow release label

- B08 event revision/project CAS is still a proposal, not implemented; B10-B14
  frontend work is partial, and M4-M7 additions are not part of this hotfix.
  Defer them to their own batches, but do not call the result a complete stable
  upgrade or imply that their pre-existing data-integrity/UX risks are fixed.
- The current integration diff contains no `prisma/schema.prisma` or
  `prisma/migrations` change against `origin/main`; therefore a schema-delta
  migration proof is not a gate for *this exact candidate*, but any later schema
  change reopens expand/contract and rollback testing. The B05 no-op migration
  rehearsal is not evidence of a schema-changing upgrade.
- Agent packaging/signing/notarization, live Windows Task Scheduler and the
  destructive device failure matrix remain outside B04's CI-fixture PASS.
  They may be deferred only if this release does not claim a signed/native
  Agent distribution; they are gates for an actual Agent release.

## Operator evidence commands (read-only until the separately approved cutover)

```sh
jq '{status,current_sprint,pending_gate}' progress.json
jq '.features[] | select(.id=="F005")' features.json
git diff --name-only origin/main...HEAD -- prisma/schema.prisma prisma/migrations
gh secret list --json name,updatedAt
gh api repos/tripplemay/tokenizer/environments/production --jq '{name,protection_rules}'
gh run view <run-id> --json headSha,status,conclusion,event,jobs
gh run download <run-id> -n "release-recovery-<sha>" -D <empty-dir>
node scripts/ci/recovery-evidence.mjs verify <empty-dir> <sha> false
curl -fsS https://token.vpanel.cc/api/health
```

For a **main** recovery artifact, the verifier's final argument must be `true`;
`false` only authenticates the non-main synthetic artifact contract. The real
baseline cutover requires a reviewed runbook and operator access, not the
read-only commands above. Do not print `.env` or backup contents into logs.
