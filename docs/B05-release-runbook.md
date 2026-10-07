# B05 deployment and recovery runbook (round 2 candidate)

This is a procedure, not an independent signoff or production evidence. Pushing
`main` initiates production deployment. No production action was taken by the
generator. B02 dependency/auth hardening and B01's complete CI prerequisites must
be retained when integrating this separately based candidate.

## Immutable artifact and gates

`release-artifact` runs on Linux after Linux and Windows verification. It builds
the app and migration targets in CI, emits BuildKit provenance, and publishes
candidate images to GHCR for main (an ephemeral registry for PRs). The job's
outputs are OCI manifest/index digest references, not mutable tags or daemon
image IDs. Source revision labels are checked at runtime. Main artifacts receive
GitHub-signed provenance; both the artifact job and the deploy job enforce the
source SHA, repository, and exact signer workflow with `gh attestation verify`.
Missing registry/attestation access fails closed. There is no VPS build step.

The Linux job runs `scripts/test/rehearse-release.sh` with previous source images
and candidate digests. This synthetic previous-source build is a compatibility
baseline, not evidence of the image actually serving production. The VPS repeats
the rehearsal using its actual retained previous digest and a current live DB
dump **before live migrations**. The deploy job needs the artifact/recovery job.
Integrators must also retain B01 PostgreSQL, contract, and Playwright needs.

Registry package access, Actions OIDC/attestation permissions, current `gh`,
Buildx, and Compose support for `!reset` are deployment prerequisites. The current
repository is public; moving it to private requires reviewing attestation plan
availability. No unsigned production fallback is provided. CI uses linux/amd64;
an ARM VPS requires an explicit platform addition and its own runtime gate.

## Recovery rehearsal contract

The script creates randomly named containers on an `--internal` Docker network.
Scratch apps receive synthetic auth/mail secrets, no production credentials,
no host port, and auto-pricing disabled. The live database is only read by
`pg_dump`; it is **never** the target of `pg_restore`, canary writes, or scratch
migrations. Dumps and checksums stay in mode-restricted `.releases/` on the VPS;
only synthetic CI dumps are uploaded as CI artifacts. Treat a live dump as
sensitive and apply the operator's encrypted off-host backup retention policy.

Stages, each fail-closed:

1. Synthetic mode initializes the previous schema and a synthetic canary row;
   live mode takes a custom-format, consistent PostgreSQL dump of the real DB.
2. Checksum the dump, restore to a new isolated PG16 container with
   `pg_restore --exit-on-error`, record user/device/project/event counts and
   token sum. Synthetic mode additionally compares the source inventory.
3. Apply the exact candidate migration image; require critical inventory to
   remain unchanged. Data-transforming migrations require an explicitly
   reviewed inventory policy rather than bypassing this guard.
4. Observe a nonzero runtime UID and exact revision labels; start candidate,
   check health, then run real HTTP enroll -> authenticated ingest -> session
   authenticated summary with one synthetic tenant. Confirm 23 tokens/one DB
   event and cascade-clean that tenant. Recheck inventory after cleanup.
5. Start the retained old app **against the migrated scratch DB**, run the same
   authenticated business canary, and recheck cleanup. Only then write the
   rollback compatibility gate for the exact previous digest.
6. Remove scratch containers **including anonymous volumes** and the network
   on success or failure. Retain dump/checksum and a bounded rehearsal ledger.

This inventory is not a full semantic/schema-drift audit; constraint restoration,
critical row/token counts, and the business path are checked. Measured elapsed
seconds are rehearsal duration, not an RPO/RTO SLA. No production data restore,
credential rotation, email delivery, or live user-login claim follows from it.

## Existing VPS migration to digest deployment

The first legacy local-build deployment will **intentionally refuse replacement**
unless `.releases/<candidate-sha>.previous-env` has a digest-pinned `APP_IMAGE`
and `MIGRATE_IMAGE`, and the running app's image ID matches that retained digest.
Do not fabricate this ledger or waive the check by deleting the old container.
The coordinator must first build/attest the exact previous source as a portable
artifact, rehearse it against a restored backup, and perform an observed,
authorized baseline cutover to that old digest. Capture its SHA and configuration
before approving the next release. The bootstrap is a separate maintenance
operation; this generator did not execute it. Never confuse a same-source
rebuild with the prior running daemon image ID.

`POSTGRES_PASSWORD` must equal the existing persisted PostgreSQL role password.
Setting the secret does not rotate that role. Do not rotate it in this release.
Set independent strong `ADMIN_TOKEN`, `AUTH_SECRET`, real `AUTH_RESEND_KEY`, and
HTTPS `NEXT_PUBLIC_APP_URL`; the workflow preflight and VPS guard reject missing,
placeholder, padded, and interpolation-unsafe auth settings without logging them.

## Activation, containment, and rollback

The workflow retains the old mode-restricted environment once per SHA, passes
short-lived GHCR credentials over SSH stdin, and removes the registry login at
the end. It writes the candidate digests into `.env`; the release script verifies
the immutable SHA/digest ledger and images. Live scratch recovery rehearsal must
pass before live migration and app replacement.

Live migration failure does not start the new app. Investigate a partially
applied migration before allowing writes; do not claim image rollback restores
the DB. After app replacement, any failed readiness, SHA check, or startup command
triggers an EXIT trap: stop the new app first. Only a freshly successful actual
old-digest/new-schema rehearsal gate permits automatic app-only rollback with
the retained environment. Rollback must return the exact old SHA and healthy
response; failure stops it again. The workflow still exits nonzero, even when
rollback succeeds. A missing gate leaves the app stopped for operator action.

The activated ledger records expected SHA, portable app digest, and observed
local image ID only after new readiness passes. Inspect without printing `.env`:

```bash
docker compose -f docker-compose.yml -f docker-compose.release.yml ps
test -f ".releases/$SHA.manifest"
test -f ".releases/$SHA.rehearsal"
test -f ".releases/$SHA.activated"
curl -fsS http://127.0.0.1:3010/api/health/live
curl -fsS http://127.0.0.1:3010/api/health
curl -fsS http://127.0.0.1:3010/api/health/capabilities
```

Finish with the coordinator's scoped production canary, email/login checks,
browser freshness observation, and independent acceptance. Readiness is not
those tests. A destructive/incompatible migration needs expand/contract or an
explicit downtime/data-loss-approved restore into a fresh volume; this code does
not automatically restore production data.

## Evidence boundary

The generator executed macOS unit/fault-trace, syntax, type, lint, local build,
and a supplemental native PG16/production-Next rehearsal: real authenticated
canary, custom dump/checksum, isolated restore, exact migration replay, canary
on restored DB, and unchanged critical inventory. Both Next processes and the
scratch PG cluster were stopped. This did not execute the Docker orchestration
or old-image rollback; the exact handoff records outcomes, including failures.
Docker daemon absence prevents local Linux image/PG16 container rehearsal.
The new real CI gate and signed registry path have **not yet run**. Independent
Linux CI/staging execution is required before claiming B05 complete or releasing.

Primary interface references: [Docker build action](https://github.com/docker/build-push-action),
[Docker provenance](https://docs.docker.com/build/metadata/attestations/slsa-provenance/),
[GitHub signed attestations](https://github.com/actions/attest-build-provenance),
[GitHub CLI verification](https://cli.github.com/manual/gh_attestation_verify).

## Round 3 runtime boundary and predecessor correction

The health migration-directory read now has a fixed, statically traceable path.
Only `/api/health` explicitly includes the migration files in output tracing.
`scripts/verify-standalone.mjs` is mandatory in the candidate Docker builder:
it rejects unrelated repository state/reports/source/secrets and requires the
runtime server and migration markers. Next15's two imported release JSON
catalogs are exact-file exceptions only; Next16 inlines those catalogs. The
historical-source rehearsal uses its historical Dockerfile plus trusted workflow
revision labels, not the candidate Dockerfile requiring the new verifier.

The deploy token grants `attestations:read`. Main artifact verification includes
wrong-source/wrong-workflow rejection controls; real execution remains a gate.
`scripts/select-release-predecessor.sh` uses PR base/push-before/operator SHA,
or fetched `origin/main` on a test-branch workflow dispatch. It verifies that the
commit exists and rejects candidate-as-predecessor. An explicit dispatch-only
`bootstrap_rehearsal` permits a same-SHA preparatory run but **disables production
deployment**, and must never be reported as old-version compatibility. A main
dispatch without a distinct predecessor consequently fails closed unless this
explicit non-deploying bootstrap mode was selected.

The generator's actual Next16 standalone observation was 80M, with no dynamic-fs
trace warning and only `.next`, `node_modules`, `package.json`, `prisma`, and
`server.js` at its root. Against a native scratch PG16 DB, the standalone health
returned 200; hiding its generated migration directory returned 503; restoring
that directory returned 200. These native observations do not replace Linux OCI
or actual previous-version/provenance acceptance. Round3 evidence is in
`docs/test-reports/M1-B05-R13-round3-generator-handoff.json`.
