# Codex quota-window repair: release record

## Authorization and scope

On 2026-09-16 the user explicitly requested commit, push and deployment after
approving the local repair. This is the release authorization for this task.
Only the previously inspected source/test patch and its evidence are in scope.

The main workspace's BL-HOMEPAGE-FRESHNESS batch remains in verifying, with its
original F005 pending. This repair is registered as its F006 hotfix, referencing
the isolated BL-CODEX-QUOTA-WINDOW F001 implementation and F002 independent
verification. Their original verdict identifiers are preserved, not rewritten.
The main batch is not overwritten with the isolated worktree's done state.

## Provenance

- Source baseline: `9ccb117f5538e512a42ef3b3dd9dc7af27d0841c`.
- Applied source/test patch: 10 files, SHA-256
  `fddd8a10db87cd17a9b430bc65f41c1a0ade23682eabd06bf5a1164c43afce19`.
- Independent Kimi verdict copied byte-for-byte, SHA-256
  `9fd82f91cb0465dcd477d480d078bdaa0dcd0baff1a644bfd8c8d7f2eed487bf`.
- All 10 applied files match the previously tested delivery bytes.
- Kimi's required JSON verdict was completed and validated before its deadline;
  its process later timed out while writing an optional Markdown supplement.
  No completed optional supplement is claimed.
- No migration, agent version bump, credentials or workflow changes.
- Existing unrelated file-mode changes are excluded from staging and preserved.

## Pre-release baseline

- Public `/api/health`: ok=true, running commit
  `8db58c296bd78a70ec4f75e1c4d4ef2687277f61`.
- Previous Deploy VPS run `34553333841`: Linux Verify and Deploy succeeded;
  Verify (Windows) failed. New failures must be compared to this baseline, not
  silently described as a green workflow.

## Verification and release status

Main-workspace rechecks completed before committing:

- `npm run lint`: exit 0, no ESLint warnings/errors.
- `npm run verify`: exit 0.
- `env -u DATABASE_URL npm run test`: exit 0; 1453 passed, 20 skipped.
- `env -u DATABASE_URL -u AUTH_SECRET npm run build`: exit 0.
- `git diff --check`: exit 0.
- Repository verdict-schema validator: valid, two feature verdicts, evidence present.

## Released version and CI

- Release commit pushed to `origin/main`:
  `92d410c6d0bd7fbb9ca4bdb0d984936c0a1db2a1`.
- [Deploy VPS run 35017447796](https://github.com/tripplemay/tokenizer/actions/runs/35017447796)
  completed on that exact SHA.
- Linux Verify: success; 1453 tests passed, 20 skipped; typecheck and Next.js
  build succeeded.
- Deploy: success, completed at `2026-09-15T20:16:23Z`.
- Verify (Windows): failure; 1442 tests passed, 28 skipped, 3 failed. The
  workflow's overall conclusion is therefore failure, not a fully green CI run.
  Deploy intentionally depends only on Linux Verify; no workflow change was made.
- The three Windows failure names exactly match baseline run `34553333841`
  (programmatic comparison passed):
  - `tests/cli/agent-lifecycle.test.ts`: releases the lock when the running agent
    receives SIGTERM.
  - `tests/cli/install-agent-lifecycle.test.ts`: stops this install's wrapper and
    child without touching another install.
  - `tests/cli/install-agent-lifecycle.test.ts`: uses directory-scoped matching
    instead of broad tokenizer-agent process search.
  These existing Windows lifecycle issues are outside this quota-label repair.

## Post-deployment verification

- Deployment log: 28 migrations found, no pending migrations; PostgreSQL healthy,
  application container recreated and started; internal health check passed at
  `2026-09-15T20:16:21.0135426Z`.
- Public `https://token.vpanel.cc/api/health` returned HTTP 200:

  ```json
  {"ok":true,"timestamp":"2026-09-15T20:17:05.966Z","commit":"92d410c6d0bd7fbb9ca4bdb0d984936c0a1db2a1"}
  ```

- Public `/login`: HTTP 200. Unauthenticated `/`: HTTP 307 to `/login`.
- Real Tabbit browser check at `2026-09-15T20:17:25.075Z` also reached `/login`;
  no authenticated quota rows were available. The user was asked to log in.
  Authenticated production homepage rendering remains unverified and is not
  inferred from CI, fixtures, or health. Original F005 remains pending.
- This release-record follow-up changes only `docs/`, which is ignored by the
  deployment workflow. Its later commit does not replace the running release SHA.

## Local log integrity

The following ignored raw logs are retained locally; durable remote evidence is
the Actions run linked above. SHA-256:

- `BL-CODEX-QUOTA-WINDOW-release-linux.log`:
  `dd44614da89abed7dca2f8f5db750d625a1762cf6bf7bc989bd727fc3ec0e1f9`.
- `BL-CODEX-QUOTA-WINDOW-release-windows.log`:
  `f838291c9bba01f8a962bdedcb752d2f5052a20681233864b13ef621d223b493`.
- `BL-CODEX-QUOTA-WINDOW-release-deploy.log`:
  `e7a28c4c93da8f7e48234f4ce7860c4bf5975a85a35da5bf463b1ebbe2fb0461`.
