# B05 deployment and recovery runbook (candidate)

This is a release procedure, not evidence of a production deploy. A push to
`main` starts production deployment automatically. The B05 candidate must not be
merged until the human release owner accepts the gates below.

## Runtime contract

- `GET /api/health/live` is process liveness only and does not touch the DB.
- `GET /api/health` is readiness: required auth/admin/mail configuration, DB
  query, and the latest checked-in Prisma migration marker must pass. It emits
  stable error codes and a request ID, never an exception or connection string.
- `GET /api/health/capabilities` reports auth/admin/mail availability and
  whether harness signing is `ready` or `read_only`. Missing optional signing
  does not turn core readiness green into a claim that approvals can be signed.
- A ready response is not a business canary or a full schema-drift check.
  Monitor enroll -> ingest -> summary separately with a scoped test tenant.

The app runner is `node` rather than root. The workflow still uses its
configured VPS SSH account and builds images **on the VPS**. Image names carry
the expected Git SHA, and `.releases/<sha>.manifest` records Docker image IDs
and revision labels. These IDs are not OCI manifest digests or proof of a
CI-built, registry-pinned artifact. A same-SHA image ID change is refused.

## Before any production merge

1. Pin the exact commit and review the intended diff. Resolve the separate B02
   dependency release gate; B05 does not waive it.
2. Verify `POSTGRES_PASSWORD` in GitHub Actions secrets equals the **existing**
   live PostgreSQL user password. The old Compose default may still be in use.
   Changing the secret does not rotate a persisted PostgreSQL role. Do not
   rotate the database password as part of this candidate. Plan rotation
   separately with backup, dual-access/cutover, and client verification.
3. Set valid independent `AUTH_SECRET`, `ADMIN_TOKEN`, `AUTH_RESEND_KEY`, and
   HTTPS `NEXT_PUBLIC_APP_URL`. The preflight rejects control characters,
   interpolation, quoting, and weak/missing required values without echoing
   secret contents. Check mail delivery and Auth.js login separately.
4. Make a timestamped, access-controlled PostgreSQL backup with an integrity
   checksum. Restore it to an isolated scratch project and volume, not the
   live `postgres-data` volume. Check row counts and key owner/usage queries.
5. Apply the **exact pending migrations** to the restored scratch database.
   Run the critical read/write path and assess old-app/new-schema compatibility.
   If a migration is not backward compatible, use an expand/contract sequence
   or schedule downtime and a DB restore plan; image rollback alone is unsafe.
6. Rehearse old image + prior `.env` recovery in scratch and measure actual
   recovery time and data-loss window. Do not assign an RPO/RTO from the mere
   existence of a dump file. Verify the previous image ID remains available.
7. Build the Linux image and check the runtime UID, revision label, DB startup,
   migration completion, and health on an isolated synthetic Compose project.
   A CI-built immutable OCI manifest digest and digest-pinned deployment are
   still missing; approve this limitation explicitly or implement it first.

## Deployment observation

The workflow syncs source, backs up the previous `.env` to mode-restricted
`.releases/<sha>.previous-env` once, renders the new `.env`, builds SHA-tagged
images, records their IDs, records the previous running app image ID, runs the
one-shot migration, then starts the app with `--no-deps`. It writes
`.releases/<sha>.activated` only after readiness returns the expected SHA.

Check, without printing secrets:

```bash
test -f ".releases/$SHA.manifest"
test -f ".releases/$SHA.activated"
docker compose ps
curl -fsS http://127.0.0.1:3010/api/health/live
curl -fsS http://127.0.0.1:3010/api/health
curl -fsS http://127.0.0.1:3010/api/health/capabilities
```

Confirm `ready`, the exact expected commit, auth/admin/mail capability,
and the signing `ready`/`read_only` state. Then run a scoped test-tenant
enroll -> ingest -> summary canary with cleanup. A green `/api/health` alone
does not prove that flow.

## Failed deployment / human recovery

Migration failure prevents this script from starting the new app, but the
script does not restore the DB or `.env` automatically. Readiness failure after
app start also does not auto-rollback. Preserve logs and identify whether
schema/data changed before making a recovery decision.

For a backward-compatible schema only, the operator can inspect
`.releases/<sha>.previous-app-id` and the prior mode-restricted `.env`, verify
that image ID and its old tag still exist, restore the previous `.env`, and
run `docker compose up --no-deps -d app`. Recheck old SHA, readiness,
auth-capability, and the business canary. Do not print `.env` or source it into
a shell. If there is no previous image/config, this path is unavailable.

For an incompatible or destructive migration, **do not claim image rollback
restores data**. Stop writes, select the verified pre-migration backup, obtain
explicit approval for the data-loss window, restore into a fresh volume, check
integrity, and only then cut over the compatible old app. Preserve the failed
volume and release artifacts for diagnosis. This runbook does not execute that
production restore or rotate production credentials.
