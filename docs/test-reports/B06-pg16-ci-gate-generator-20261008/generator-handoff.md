# B06 native PG16 CI gate Generator handoff

## Candidate

- Base: `4da6604d0c086cdaa9ef56e492e1ff333b5caf4b`
- Product/test commit: `d3bbb67df44950d2eb5bcc93b86a45a417fc54f4`
- Branch: `codex/b06-pg16-ci-gate-20261008`（未 push）
- Worktree: `/Volumes/ORICO/project/.worktrees/tokenizer-b06-pg16-ci-gate-20261008`

This is a narrow CI-gate correction. It does not change the B06 routes,
validator, Prisma schema, migrations, client queue behavior, release state or
human gate.

## Change

`.github/workflows/deploy-vps.yml` now makes the existing PostgreSQL 16 job run
`tests/server/b06-batch-db.probe.test.ts` explicitly, alongside every historical
probe already present.

- The service database and all DB probe URLs use `tokenizer_ci_scratch`, which
  satisfies the B06 probe's explicit scratch-only guard.
- `EVAL_B06_DB_URL` exactly matches `DATABASE_URL`.
- `TZ: UTC` makes the Node/Prisma side of the job deterministic; the PostgreSQL
  service's scratch database remains isolated to the CI service container.
- The existing JSON result assertion remains no-skip/no-failure and its minimum
  floor rises from 10 to 13, accounting for the three dedicated B06 tests.
- The five historical probe paths are unchanged and remain in the same command.

`tests/ci/b06-pg16-workflow-gate.test.ts` statically locks the scratch database,
matching B06 URL, UTC setting, one dedicated probe occurrence, retained
historical probe set and raised assertion floor.

## Verification at exact product commit

All commands used Node `v22.22.0`.

| Check | Result |
| --- | --- |
| `npm run verify` | PASS |
| `npm run lint` | PASS |
| full `vitest run` | 121 files passed / 9 skipped; 1657 tests passed / 25 skipped |
| workflow static regression | 2/2 PASS |
| local PostgreSQL workflow-equivalent matrix | 6 files, 51/51 PASS, zero skips/failures |
| `assert-vitest-results ... 13` | PASS: `Verified 51 tests with no skips or failures` |
| missing `EVAL_B06_DB_URL` negative control | expected FAIL: total 51, passed 48, skipped 3, exit 1 |
| PostgreSQL runtime | Homebrew 16.13, timezone UTC |
| teardown | B06 users/devices/events all 0; scratch cluster stopped |

The local PG command used the exact six-file workflow list: the new B06 probe
plus all five historical probes. This preserved the historical F003/F004/F007
coverage and proved the B06 dedicated test cannot silently skip when its env is
missing.

## Remaining boundary

- No GitHub run was started by this Generator. The orchestrator must run a new
  safe-branch workflow at the final exact SHA and confirm Verify, Windows,
  PostgreSQL 16 and browser jobs succeed while Deploy is skipped.
- Formal acceptance remains with an independent different-model-family
  Evaluator.
- This closes only the native PG16 evidence gap. Full B06 is still separately
  blocked on client poison-row quarantine, partial ACK/rejected IDs, good-row
  liveness and repair/replay.

## Evidence

- `evidence/workflow-static-test-final.log`
- `evidence/verify-node22-final.log`
- `evidence/lint-node22-final.log`
- `evidence/full-node22-final.log`
- `evidence/pg16-workflow-matrix.log`
- `evidence/pg16-assert.log`
- `evidence/pg16-missing-b06-negative.log`
- `evidence/pg16-version-timezone-cleanup.log`
- `evidence/pg-stop.log`
