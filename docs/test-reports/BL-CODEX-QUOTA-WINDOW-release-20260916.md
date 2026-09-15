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

Release commit, workflow results and post-deployment health verification will be
appended after deployment. Authenticated production homepage rendering is a
separate check and must not be inferred from CI or health.
