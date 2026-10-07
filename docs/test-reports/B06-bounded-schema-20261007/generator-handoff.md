# B06 bounded server schema: Generator handoff

Role: isolated Generator; local self-tests, NOT independent acceptance.
Base: `4d96e4bb23224f393099b2187c8b42cd7a521cd8`.
Resumed checkpoint: `c4972489510698979bc184b5603a514d72ea3d64`.
Worktree: `/Volumes/ORICO/project/.worktrees/tokenizer-b06-bounded-schema-20261007`.
Node: v22.22.0, npm ci in this worktree, macOS arm64.
Scratch TMPDIR: `/Volumes/ORICO/project/.b06tmp`.
No original/integration tree edits, push, state/features/gate changes or production access.

## Delivered slice

- Shared `src/server/batch-input.ts` reads actual bytes (1MiB cap BEFORE parse),
  strict UTF-8/JSON complexity, bounded row counts/strings/raw JSON,
  source/provider enums, real UTC calendar dates, PostgreSQL Int/Decimal and
  safe JSON BigInt ranges. Fixed structured 400 codes do not echo input/errors.
- Both batch routes authenticate/read token-device binding first, then validate
  ALL rows before timezone/device/token/project/event/quota/cache/pricing writes.
  Unknown sources, coercions, malformed/mixed rows fail closed as whole-batch 400.
- Quota keeps the old `{snapshots}` envelope with omitted device; capturedBy and
  tenant derive only from the token. BigInt conversion no longer rounds input.
  Legitimate nullable/omitted scalar fields remain compatible. Actual collector
  output proves utilization 0..1 (35.5 percent -> 0.355), not 0..100.
- Usage B03 privacy minimization and canonical source identity remain unchanged.
  Actual minimizer output and legacy nullable diagnostics are admitted. No client
  production code, schema/migration, outbox or CI changes.
- Specification: `docs/specs/B06-bounded-server-schema-slice.md` lists exact
  bounds, ordering, compatibility and remaining protocol/client blockers.

Full B06 is NOT DONE: client poison-row quarantine, partial/rejected-ID ACK,
user-visible queue repair and good-row liveness remain unimplemented. A poison
batch can pin good neighbours; whole-batch 400 preserves all unacknowledged rows
instead of returning a destructive 200. Future B07 remains a separate outbox /
ingest-atomicity task: valid requests failing later DB/pricing operations are not
made transactionally atomic by this slice. Native CI and fresh independent review
are pending; nothing here is release approval.

## Active test expectation changes vs immutable evidence

`usage-batch-input.test.ts` formerly explicitly accepted a poison source and
overlong/NUL device. Its baseline 2-test PASS is retained in
`evidence/baseline-poison-acceptance.log`; the active expectation now rejects
before writes and preserves a separate valid success/cache case.

Only the old F003 DB case in active
`tests/evaluator/bl-security-p1-f008-probes.test.ts` changes from poison-2xx to
poison-400/unchanged device/token/event state, plus correct token-device fixture
binding. Other sanitizer/render/concurrency/cost tests remain. This is a
Generator-authored expectation update, not a fresh evaluator verdict.

Before touching those files, the six in-base `SHA256SUMS`/`*.sha256` manifests
were searched for either test path; none owns them. The manifest path inventory
and empty ownership search are retained. `historical-report-diff.log` is empty:
no prior independent report, verdict, evidence or manifest is modified. Old
reports that described poison acceptance remain historical and are not rewritten.

## Generator tests and preserved failures

| Run | Result | Evidence |
| --- | --- | --- |
| Existing poison test on base | 2 passed, demonstrating old poison acceptance | baseline-poison-acceptance.log |
| New source-poison test with exact original usage route restored | expected failure: HTTP 200 vs required 400 | baseline-negative-unit.log |
| New real PG mixed-row test with exact original usage route restored | expected failure: HTTP 200 vs required 400 | baseline-negative-pg.log |
| Route identity during negative | empty diff against 4d96e4b | baseline-route-identity.diff |
| Development focused first run | 67 passed, 1 failed due incorrect test expectation for global NUL rejection; corrected invalid_device -> invalid_json | focused-development.log |
| Final focused including actual wire/old queue checkpoint/retry tests | 99 passed, 3 optional PG skips | focused-final-4.log |
| Real isolated PG16 UTC | 44 passed: new 3 plus existing F008 41; repeated with nullable quota rawJson | pg-probe-final.log, pg-probe-final-null-2.log |
| Standard full, before final 3 new compatibility/queue tests | 1652 passed, 25 skipped | full-final.log |
| Standard full, final source/test set | 1655 passed, 25 skipped; 120 files passed, 9 skipped; repeated after type-only cast correction | full-final-2.log, full-final-3.log |
| verify development after queue negative added | exit 2: intentional poison fixture needed explicit unknown cast; raw failure retained | verify-final-3.log |
| verify (final tests included, fixture type corrected) | exit 0 | verify-final-4.log |
| lint | exit 0 | lint-final.log |
| build | exit 0 | build-final.log |
| source/docs diff --check excluding raw evidence | exit 0 | source-diff-check.log |
| raw evidence diff --check | exit 2: native command-output trailing whitespace/EOF blank lines retained deliberately | raw-evidence-whitespace.log |

Tests cover malformed/UTF-8/stream exceptions, missing or forged Content-Length,
1MiB+1 actual bytes with cancellation and no parsing ACK, exact 1MiB including
split multibyte UTF-8, JSON/raw depth/byte/count boundaries, mixed rows,
unknown sources/providers, negative/fraction/string/nonfinite/overflow counts,
Int fallback-sum overflow, Decimal/BigInt ranges, invalid UTC calendar dates,
controls/NUL/surrogates, diagnostics/timezone, device-owner boundaries and no
business effects. The current Agent test verifies a whole-batch 400 never calls
onBatchSynced and leaves the complete durable good+poison queue byte-identical.

## Real PG scope and replay

Docker was unavailable (old checkpoint log retained), but Homebrew PostgreSQL
16.13 was used successfully. A NEW cluster was initialized under
`/Volumes/ORICO/project/.b06tmp/pg16.5aqQtx/data`, bound to loopback:55466 with
UTC and database `b06_scratch`. Existing Prisma migrations were applied there
only. All credentials/data were synthetic. Tests use real Prisma/auth/token
hashing/ingest; Next cache/pricing trigger are mocked to avoid unrelated runtime
context/external network. No production database was read or written.

The new probe checks explicit matching scratch URLs and PG16 before writes.
After test cleanup, the only remaining user is migration seed
`user_default_seed`; B06 and F008 synthetic user counts are zero
(`pg-cleanup-confirmation.log`). An earlier all-user count=1 was initially
misreported in a progress message as zero, then corrected with this query.
The owned cluster was stopped (`pg-stop-final.log`), not left running.

A final nullable-rawJson rerun initially stopped the owned PG process before
the yielded test completed (operator sequencing error, not product failure).
`pg-probe-final-null.log` retains the resulting connection/cleanup failures.
After awaiting completion correctly, the same 44 tests passed, including
quota rawJson:null. Two synthetic users left by the interrupted run were removed
by their exact IDs from this task's scratch DB (`pg-orphan-cleanup.log`); only
`user_default_seed` remains. Final stop: `pg-stop-clean.log`. No other database
or user data was touched, and no failed run is erased from this evidence set.

Replay in a separately initialized/migrated UTC PG16 scratch database:

```sh
export PATH=/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin:$PATH
export TMPDIR=/Volumes/ORICO/project/.b06tmp
export DATABASE_URL=postgresql://b06_scratch@127.0.0.1:55466/b06_scratch
export EVAL_B06_DB_URL=$DATABASE_URL EVAL_DB_URL=$DATABASE_URL
npx prisma migrate deploy
npx vitest run tests/server/b06-batch-db.probe.test.ts tests/evaluator/bl-security-p1-f008-probes.test.ts
```

Standard runs used no optional DB URLs and no concurrent local stress/build.
Final full command is `npm test`; focused command is the eight-file set in
`results.json`. Local macOS results are not native Linux/Windows CI results.
The raw development/negative logs are intentionally retained, not overwritten
or reinterpreted as an all-green history. Commit SHA is delivered separately
after exact staging; this handoff and result artifact are Generator evidence only.
