# M1 B05 / R13 generator notes (2026-10-07)

Base: `2074991717abaf3cb34d9aad894bcd4357fefbc3`; isolated detached
worktree `tokenizer-b05-deploy-20261007`. This is an out-of-band Generator
candidate, not a release verdict. No original-tree, status/gate, production,
or push operation was performed.

## Candidate slice

- Public `/api/health` no longer returns DB exception text. It checks required
  production auth/admin/mail configuration, `SELECT 1`, and the latest
  checked-in Prisma migration marker; failures return a stable code, commit,
  and request ID. Internal logs contain stage and bounded DB error code, not
  exception message. `/api/health/live` has no DB dependency;
  `/api/health/capabilities` distinguishes signing `read_only` from `ready`.
- Deploy preflight rejects missing/default auth/admin/mail/DB/HTTPS settings,
  unsafe Compose `.env` characters (including newline, CR, spaces, `$`, quotes,
  and backslash), unsafe VPS path/port/user/host, and empty SSH key. It names
  failed keys without printing values. The workflow writes the SSH key from
  an environment variable rather than inline expression and preserves a
  mode-restricted prior `.env` once per SHA.
- App image runs as `node`. Compose's direct `up app` requires a completed
  migration; the scripted deploy explicitly runs migration, then starts app
  with `--no-deps`. SHA-tagged app/migrate image IDs and OCI revision labels
  are checked and recorded before migration. A same-SHA image-ID change is
  refused. The prior running app image ID is recorded for human recovery.
- The workflow checks readiness **and** exact expected SHA, writing an
  activation marker only on success. It no longer prunes old images in the
  deploy path. `docs/B05-release-runbook.md` records backup/scratch-restore,
  compatibility, business-canary, and operator-led rollback gates.

## Executed verification and fault injection

- `npm ci`: exit 0, 637 packages installed (baseline audit advisories handled
  in separate B02 work).
- `npm run verify`: exit 0. `npm run lint`: exit 0. `npm run build`: exit 0;
  Next.js listed all three health routes.
- `npx vitest run tests/server/release-image.test.ts tests/server/health.test.ts tests/server/deploy-secrets.test.ts`: exit 0, 36 passed. Synthetic faults cover DB exception canary exclusion from response/log, missing config, missing migration, image revision mismatch, same-SHA image drift, migration failure (no app start), and wrong health SHA (no activation).
- `npm test`: exit 1, **2 failed / 1479 passed / 20 skipped**. Both failures
  were `tests/cli/agent-lifecycle.test.ts` SIGTERM assertions: lock still
  existed and wrapper exit signal was `SIGTERM`, not `null`. This is the raw
  full-suite result; it is not reclassified as green. A separate
  `npx vitest run tests/cli/agent-lifecycle.test.ts` exited 0 with 6 passed,
  consistent with timing sensitivity but not proof of root cause.
- `bash -n` for the three deploy scripts, `git diff --check`, workflow YAML
  parse, and `docker compose config --quiet` with synthetic values: exit 0.
  This validates syntax/interpolation only, not container behavior.

## Release blockers and integration notes

- **Linux Docker image, runtime UID, migration, and actual backup/restore were
  not exercised.** Local Colima was stopped; a scratch profile start was
  interrupted immediately after the disk-image download began because the
  internal Data volume had only ~18 GiB free. It created no VM/profile and
  only a ~20 KiB config directory. Do not substitute the mocked release tests
  for isolated Linux/Compose/PG validation.
- Images are built on the VPS. Docker image IDs are not OCI manifest digests;
  there is no CI-built digest-pinned artifact, provenance check, or tested
  automatic app rollback. Readiness checks only the latest migration marker,
  not schema drift or the enroll -> ingest -> summary business flow. No
  production RPO/RTO is established.
- The production PostgreSQL role may still use the old Compose `tokenizer`
  password. The new `POSTGRES_PASSWORD` secret must match that **current**
  password before any merge; no rotation was performed. Human-owned rotation
  SOP, scratch restore, migration compatibility decision, controlled canary,
  and live release approval remain open. An irreversible migration cannot be
  undone by changing app image. `B02` dependency release gate remains separate.
- Combined-tree review should pay special attention to possible B02 overlap
  in `.env.example`, `docker-compose.yml`, `scripts/validate-deploy-secrets.sh`,
  and `tests/server/deploy-secrets.test.ts`; re-run the same tests on the
  combined tree. B03 privacy changes are not included in this baseline diff.

Official references checked 2026-10-07:
[Compose `.env` interpolation and inline comments](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation),
[Compose startup conditions](https://docs.docker.com/compose/how-tos/startup-order/),
[Docker image ID versus registry digest](https://docs.docker.com/reference/cli/docker/image/ls/),
[Prisma `migrate deploy` scope](https://docs.prisma.io/docs/cli/migrate/deploy).
