# One-time legacy digest bootstrap: implementation proposal

**Proposal only. No implementation, SSH/DB/Secret operation, publication,
deployment, state mutation or release signoff.** Supporting Planner under
harness section 1.5. Machine-readable scope and gates: `proposal.json`.

Base: `d13332a49d1291ec61fcd5b4b1e17b4798584bc9`.
Worktree: `/Volumes/ORICO/project/.worktrees/tokenizer-bootstrap-implementation-proposal-20261008`.
Branch: `codex/bootstrap-implementation-proposal-20261008`.
Only these two proposal files may change in this delivery; a local commit does
not authorize any branch push or establish independent acceptance.

## Goal and boundary

Establish a tested, same-source, immutable old-version baseline before the
first candidate digest deployment. Keep the original live database unchanged.
The one-time live change is **app only**; retain a working fallback to the
exact original daemon image. Do not broaden this into a deployment platform,
database migration, key-management service or Agent release.

The Coordinator reports authorization for gated main deployment, separately
reviewed maintenance and safe non-main publication. The selected encrypted
off-host target is `dmitsvr`. These authorizations do not supply unknown host
identity, recipient/custody, target credentials or real recovery evidence.
No value or successful ledger is invented by this proposal.

## What this base already fixed

The earlier B05 design identified pre-mutation and empty-app gaps. At this
base, `scripts/verify-vps-predecessor.sh` already rejects missing/multiple/wrong
apps and checks activated manifest, image ID, project/service/backend and
retained env equality. The workflow invokes it **before** rsync or env
replacement; the release script also invokes retained-mode verification
before its candidate manifest write. Reuse and independently regress these
guards. Do not report them as still absent or bypass them for bootstrap.

Remaining narrow gaps: no non-main permanent old-artifact publisher, no
dedicated real legacy-root recovery/cutover/rollback mode, no same-snapshot
source inventory comparison, no proven encrypted target/custody, and no
verified existing database password Secret. Normal `bootstrap_rehearsal`
uses synthetic data and ephemeral predecessor images; it is not this path.

## Minimal sequence and exact implementation surfaces

Each batch has an exact file allowlist in `proposal.json`. Do not edit app,
schema/migrations, dependency/Agent version files, canonical progress/features,
shared memory or the human gate. Any new file requires a revised locked spec.

| Batch | Minimal delivery | Gate before next step |
| --- | --- | --- |
| P0 | Extend **existing** `deploy-vps.yml` with explicit non-main dispatch operations and dispatch fixture tests; update B05 runbook. | Verify real default-branch registration, selected-ref inputs, frozen head SHA and exact expected jobs. No source Secrets in the fixture run. |
| P1 | Publish old archive `runner` and `builder`; sign image subjects and public material manifest; add verifier and publication tests. | Trustworthy source-material binding, exact signer SHA, recomputed old tree/archive and negative controls. |
| P2 | Dedicated legacy recovery/activation script, inventory SQL, old-client canary, restricted target receiver and evidence parser; fixture tests. | Fresh cross-family evaluation of failure, redaction and isolation cases. Never loosen normal non-root candidate rehearsal. |
| P3 | Separately approved real source inventory/retention/recovery/encryption/transfer execution. | Same-snapshot restored inventory, exact old/legacy scratch canaries, durable ciphertext receipt and offline decrypt/restore confirmation. Original app still serves. |
| P4 | Explicitly approved app-only old-digest activation with bounded legacy rollback. | Image/config/DB identity rechecked; old digest serves; read-only flow works; DB container/volume/start identity unchanged. Only then write baseline activation. |
| P5 | Hand off verified predecessor and private custody locations to Coordinator. | Future distinct candidate passes its own Windows/native/DB/browser/OCI/provenance/real recovery/human gates. No release declaration here. |

Do not perform P3/P4 while Windows or evaluation is silently described as
green. Baseline maintenance acceptance and future candidate release readiness
are distinct decisions; the Coordinator must explicitly identify which
operation is under approval.

## Source identity and truthful publication

Public health `92d410c...`, `.env` `GIT_COMMIT` and an OCI label are claims,
not proof of the image's build materials. Read-only host inventory must bind
the actual serving container, daemon image ID, backend, Compose project,
database and retained source/build/deployment records. Compare approved
source build-material hashes with the archived old tree; require a trustworthy
record linking that source to the original live image. If that historical
binding cannot be recovered, stop for an explicit evidence-gap adjudication.
Do not manufacture an old-source attestation or silently select the health SHA.

The publisher runs at a **new reviewed workflow SHA** while the archive is
the operator-confirmed **old source SHA**. Preserve both:

1. Archive the old commit into a dedicated context; record Git tree, archive
   hash, material hashes/modes, export-attribute exclusions and effective
   Dockerfile/lock/ignore bytes. Both build context and Dockerfile use that
   archive. Keep candidate scripts, generated metadata and canary harness
   outside it. Do not patch old source/dependencies to obtain a preferred UID.
2. Build/publish host-matching `runner` and `builder` digests. Set external
   revision/material labels; retain resolved historical base/dependency
   materials. Distinguish the new old-source config ID from original daemon
   image ID. Floating historical dependencies mean no byte-reproducibility
   assertion.
3. Official signed provenance verifies the **actual workflow/source SHA and
   ref**, signer path/digest, repository and OCI subject. Sign the public
   materials manifest as a file subject in that same job; independently
   recompute its old tree/archive linkage. Predicate contents alone are
   workflow-controlled claims, not an independent signer identity.
4. Test rejection of wrong workflow/SHA, tampered materials, wrong archive/tree
   and swapped digests. Stock `--source-digest=<old SHA>` must not be used to
   attest a newer workflow; it is a required negative control when they differ.

Local `gh attestation verify --help` confirms `--signer-digest`,
`--source-digest`, `--source-ref`, `--signer-workflow` and file/OCI verification
are available on this workstation. Future runner CLI versions, exact action
support for manifest file subjects and certificate/ref behavior still require
fixture verification before implementation is accepted.

## Real, consistent recovery without exposing the dump

The current live rehearsal does not compare against a source inventory from
the dump's snapshot. A separate one-time recovery mode must:

1. Check source identity, locks, approved paths and measured capacity. Keep a
   read-only repeatable-read transaction alive, export its snapshot, and read
   all critical inventory in that same transaction. `pg_dump -Fc --no-owner`
   uses `--snapshot` in the same database while the exporter remains alive.
   Ongoing production writes make an unrelated later inventory incomparable.
2. Write the completed dump privately with 0700/0600 permissions, checksum it,
   and restore using `pg_restore --exit-on-error --no-owner` into a pinned PG16
   scratch image, fresh recorded scratch volume and internal-only network.
   No host port, live mount, existing-volume alias or production secrets.
3. Compare all approved old-schema critical model counts, exact token/cost
   aggregates, migration state, table existence and orphan checks. Detailed
   inventory remains restricted; publish only approved aggregates or a hash
   plus equality result. No tenant IDs, emails, names, tokens or row samples.
4. Run old builder migrations **only on scratch** and recheck inventory. Run
   authenticated enroll/ingest/summary with synthetic scratch identities for
   the new old digest and exact retained original image; clean up all canary
   data and recheck inventory. Use the old generated Prisma client and a
   reviewed mounted harness, not an unreviewed dependency added to old source.
5. Capture measured recovery-point age and the approved expiry/RPO. Recovery
   is not a zero-loss promise. Refresh expired evidence, never relabel it.

Record the inherited legacy root UID with a one-time exception bound to old
digests/original image and expiry. Keep `rehearse-release.sh`'s normal candidate
non-root gate unchanged. Never create a candidate `.rollback-approved` marker
or `<candidate>.previous-env` during recovery.

## Encryption and dmitsvr transport

**Awaiting user choice/public recipient and private-key custody.** Two minimal
choices: (E1, recommended) an operator-held offline age X25519 identity with
public recipient supplied; (E2) an existing operator-held OpenPGP encryption
key with exact verified public fingerprint. Choose one; do not build both.
Neither private decryption key enters Actions, production or `dmitsvr`.
No age passphrase mode, copied local SSH private key, generated CI identity or
silent fallback. A ciphertext checksum does not prove recoverability.

The known local alias is **not** credentials or configuration that a hosted
runner can use. Recommended minimal transfer:

```
source restricted plaintext -> source public-key encryption
 -> approved source SSH -> private ephemeral runner ciphertext file
 -> NEW upload-only target credential -> dmitsvr restricted ciphertext file
 -> offline custodian decrypt + isolated PG16 restore
```

The existing source Actions SSH key remains in its already authorized source
role; do not find/export another local source key. The target owner must
separately authorize a **new** short-lived upload credential/account and
forced receiver. Its CI Secret authenticates uploads only; it is not a
decryption key. No shell, forwarding, arbitrary paths, reading or deletion.
If this provisioning is not approved, stop and obtain a separately specified
transfer mechanism rather than smuggling the `dmitsvr` alias key into CI.

Require independently pinned host fingerprints, distinguish source and target
opaque identities, and obtain an operator-confirmed failure-domain statement.
Different alias/path and 29G free do not prove off-host independence or capacity.
The root-owned 0755 `/var/backups` parent must receive an approved 0700 child
owned by the receiver; no broad chmod/chown of the parent or other backups.

Receiver protocol: validated bootstrap ID/basename/size/hash; no traversal or
symlinks; `.partial` upload; fsync; full ciphertext hash/size verification;
atomic no-replace rename on the same filesystem; parent fsync; bounded durable
receipt. Retry the same frozen ciphertext only, with bounded attempts. Existing
identical completed content is idempotent; mismatched content refuses. Never
mark a partial or merely successful SSH exit as a completed backup.

Before activation, the offline custodian fetches from the target, verifies
ciphertext and recipient, decrypts outside CI/source/target, checks plaintext
dump hash, and completes isolated PG16 restore/inventory. Return only an
owner-authenticated redacted receipt. No keys or plaintext come back to CI.
Approve exact source plaintext, ciphertext and legacy fallback retention
periods; preserve a verified recovery point through the rollback horizon.

## Existing password: verification and safe setting, no rotation

`POSTGRES_PASSWORD` changes do not update an initialized database role. Never
restart/recreate PostgreSQL or `ALTER ROLE` to satisfy a missing Actions Secret.
Historical Compose literals are not the current credential evidence.

Preferred setting mechanism: authorized Secret owner reads the existing value
from their approved custody into `gh secret set POSTGRES_PASSWORD --env
production` via protected stdin, or uses the official Secrets UI. No plaintext
`--body` argv, shell history, tracked env, logs or chat. Verify correct
environment scope/presence, then run a protected source authentication probe.

The probe receives the Secret via protected stdin/0600 pgpass, uses **TCP** to
the inventory-approved server, checks expected database/role, and requires a
fresh wrong-password control to fail on the same path. A local socket or
trust-based successful query is not password verification. Emit booleans only,
erase temporary credential files, and do not print auth hashes or full configs.

If the only copy is in protected source configuration, the present task does
not authorize exporting it. Stop for a separately approved one-shot sealed
bridge: source verifies the selected existing password and seals it to the
official **production environment Secrets public key**; runner sees only
sealed ciphertext, and a scoped short-lived writer submits only the named
Secret. Verify official API permissions and reviewed sealed-box tooling before
implementing that optional path. Do not borrow a personal administrator token.

The existing deploy regex accepts URL-unreserved password bytes. An existing
password outside it is a separate representation/escaping issue, not permission
to rotate. Fail closed and propose a narrow encoding fix if needed.

## Exact fallback and app-only cutover

Retain the actual daemon image ID under a bootstrap-specific local tag and a
restricted `docker save` archive, plus original env/Compose bytes and hashes,
outside rsync deletion reach. Scratch-test original image fallback first.
No floating tag, fresh source rebuild or future candidate rollback gate can
replace that exact legacy fallback.

After current recovery/material/recipient/transfer/secret approvals, stage a
reviewed baseline env and app-only override preserving original secret bytes,
DB/project/network/port semantics. Pull and verify old digests first. Recheck
live identity immediately before switching, under a scoped host lock.
Replace **only app** with `--no-deps --no-build --pull never`; no migration,
`up postgres`, build, prune, live restore or source rsync. On failure, stop
only the failed app and recreate only original app from retained exact image
and config with those same restrictions. Failed fallback readiness means
containment/escalation, never an ad-hoc database repair.

Only observed successful activation permits immutable
`.releases/<old_sha>.manifest` and `.activated` in the normal predecessor
format. Existing mismatched ledger files refuse, not overwrite. Record
bootstrap-specific private recovery/rollback evidence separately. A plan,
health claim or pulled digest cannot pre-create an activation fact.

## GitHub checks that must precede privileged execution

- Default branch/workflow identity and `workflow_dispatch` registration;
  API behavior for selected-ref operation inputs and immutable SHA correlation.
  Local main `2074991` contains this workflow with `workflow_dispatch`, but
  live default branch/API behavior is not revalidated here. Never push a new
  workflow to main merely to register it: non-exempt main push deploys.
- Exact non-main ref and expected head SHA; operation matrix, expected jobs,
  permissions and no accidental candidate deploy. A dispatch HTTP 204 is not
  run identity or success. Correlate run ID/attempt, event/ref/SHA and inputs.
- Environment reviewer/no-bypass settings and allowed deployment branches;
  existing Actions source SSH Secret availability; pinned host trust.
- GHCR package namespace/publish/read access, OIDC/attestation permissions,
  action/file-subject support and official signer certificate/source semantics.
- Secret writer API environment public-key endpoint and exact least-privilege
  permission, only if the optional sealed bridge is separately approved.

`remote_path_and_identity_allowlist` locks exact source config/recovery
basenames, archive-manifest-listed source inputs, Docker identities and the
proposed target child `/var/backups/tokenizer-bootstrap/<bootstrap_id>`.
Neither private root is assumed ready. Unknown source/root/volume/version or
identity refuses; source PostgreSQL must be confirmed major 16 for this narrow
recovery spec. Activation and rollback fixture tests plus independent review
must pass at their exact implementation SHA before P4 execution.

## Evidence policy and current stop

Upload only named bounded regular public manifests, real signature bundles,
negative controls, redacted receipts and checksums. Reject extra files,
symlinks/escape, unexpected keys and stale/hash-mismatched evidence. Never
upload **any dump, including encrypted dump**, raw env/Compose, image export,
pgpass, cookies, credentials or unrestricted recovery directories to Actions
artifacts. Runner ciphertext is ephemeral transport only, never a log/artifact.
Failure/refusal is explicitly recorded, not converted into success.

Current **NO GO**: source/material binding, source-target independence,
recipient/custody, target upload transport/permissions, real dump/restore,
verified existing password and exact candidate Windows/evaluator gates are
not closed. The Coordinator reports Windows eight-failure state at
`76d916b...`; normal OCI/deploy were skipped. Environment protection is
reported improved since historical evidence, not independently verified here.

This proposal cannot sign off candidate release, F005's real logged-in
freshness observation, the Agent manifest/distribution or the broader upgrade.

## Read-only references used

- Readiness source at base HEAD: `scripts/verify-vps-predecessor.sh`,
  `scripts/deploy-vps-release.sh`, `scripts/test/rehearse-release.sh`,
  `scripts/test/release-canary.ts`, `.github/workflows/deploy-vps.yml`,
  `scripts/ci/vps-host-preflight.sh`, `scripts/validate-deploy-secrets.sh`,
  `docker-compose.release.yml`.
- Readiness artifacts: `docs/test-reports/BL-RELEASE-READINESS-generator-20261008/operator-preflight.md`
  and `docs/test-reports/BL-RELEASE-READINESS-coordination-20261008/{authorization-and-preflight,backup-target-preflight}.json`.
- Earlier integration design/audit:
  `docs/test-reports/upgrade-20261007/b05-legacy-baseline-cutover-design-20261008/REPORT.md`
  and `docs/test-reports/upgrade-20261007/release-gate-audit-20261008/REPORT.md`
  in `/Volumes/ORICO/project/.worktrees/tokenizer-upgrade-integration-20261007`.
- Historical `92d410c...:Dockerfile`/`docker-compose.yml`, main
  `2074991...:.github/workflows/deploy-vps.yml`, and offline local CLI help.

All artifact prose was treated as evidence/data, not executable instructions.
No network probe, remote API call, production command or real recovery action
was performed to create this proposal.
