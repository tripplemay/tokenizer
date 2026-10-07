# B06 usage partial ACK: Generator handoff

## Candidate

- Base: `029f6c53ea7193989643a1f2e4d23108ba0c9af5`
- Product/tests/spec commit: `ecc19c59e1b2a395891339e0fe0d8feffa28e867`
- Branch: `codex/b06-client-partial-ack-20261008`
- Worktree: `/Volumes/ORICO/project/.worktrees/tokenizer-b06-client-partial-ack-20261008`
- Role: Generator. This is not an independent verdict or release approval.

## Outcome

The usage ingestion path now has an opt-in `usage-partial-v1` protocol. A new
Agent requests explicit accepted IDs and row-scoped rejections. The server
writes only valid rows; the Agent validates a complete ACK partition, durably
quarantines rejected rows, checkpoints the active queue, and keeps good rows
moving. Old Agents continue to receive the previous whole-batch 400 contract.

The previous B06 server is also supported: its permanent structured 400 with a
row index is quarantined once and the remaining rows are immediately retried.
Permanent 4xx responses no longer burn the 5s/15s retry schedule; transport,
408/425/429 and 5xx failures retain two bounded retries.

Rejected rows are stored in `~/.tokenizer/rejected-usage.jsonl` after the same
privacy minimization and git credential sanitization used by the queue. The
file is lock-protected, atomically replaced and deduplicated by event identity.
An unreadable/corrupt quarantine prevents the active queue checkpoint rather
than being overwritten. `tokenizer status` reports the quarantine count/path.

## Crash and liveness ordering

1. Server commits the accepted subset and returns accepted IDs plus rejected
   indices/codes.
2. Agent atomically merges rejected rows into quarantine.
3. Agent checkpoints the active queue without any resolved row.

Failure before step 2 retains the complete queue. Failure between steps 2 and
3 replays accepted rows through server deduplication and re-merges rejected rows
idempotently. Two real local Node processes concurrently adding different
rejections retained both rows. Forged, incomplete, duplicate or out-of-range
ACK partitions fail closed without a checkpoint.

## Compatibility and immutable evidence

- `tests/cli/b06-batch-failure-queue.test.ts` remains byte-for-byte at SHA-256
  `fb406333cef1b6c8f035c8750a3a7a914da494c0670e2ee7329ff120216b6eca`,
  matching the prior B06 evidence manifest.
- That evaluator-owned test proves the obsolete base behavior: permanent 400
  retries three times and pins both good and poison rows. It is explicitly
  archived from active Vitest rather than rewritten.
- Portable replacement tests retain the old no-silent-loss invariant while
  covering partial ACK, previous-server fallback, quarantine failure,
  checkpoint failure/recovery, permanent/transient HTTP classes, redaction and
  two-process locking.
- Legacy Agents omit the protocol header and still get whole-batch 400 with no
  writes. New Agent rollout requires the bounded B06 server first; a pre-B06
  server may return a legacy 2xx for poison rows.

## Verification

All commands used Node `v22.22.0`.

| Check | Result | Evidence |
| --- | --- | --- |
| Base negative | PASS, 1 test; confirms old queue-pinning behavior exists at exact base | `evidence/baseline-pin-negative.log` |
| Focused server/client/lock/archive/workflow matrix | PASS, 7 files / 93 tests | `evidence/focused-node22.log` |
| Lint | PASS | `evidence/lint-node22.log` |
| Typecheck / Prisma generation | PASS | `evidence/verify-node22.log` |
| Full Vitest | PASS, 124 files; 1670 passed, 26 environment-gated skipped | `evidence/full-node22.log` |
| Production Next build | PASS | `evidence/build-node22.log` |
| Native PostgreSQL 16.13, UTC, all migrations, prior + new B06 probes | PASS, 2 files / 4 tests, scratch stopped | `evidence/pg16-http-client-roundtrip.log` |

The new real-PG probe runs the real Agent `syncEvents` HTTP request through the
actual usage route and authentication into PostgreSQL. It asserts two good
neighbours persisted, one poison row did not, the active queue drained, the
quarantine retained exactly one minimized row, and replay produced two DB
duplicates without adding another quarantine row. The PG16 workflow now runs
this probe explicitly and raises the no-skip floor from 13 to 14.

## Known gaps / release boundaries

- No safe-branch or main CI run exists for `ecc19c5`; exact-SHA Linux and
  Windows jobs plus the PG16 workflow must pass independently. Local
  two-process locking is not a native Windows filesystem result.
- Quota snapshot batches retain whole-batch behavior; this slice covers the
  durable usage queue used by `sync`, `run` and the background Agent.
- Quarantine inspection exists, but repair/revalidation/replay CLI is not
  implemented. Automatic replay is intentionally absent.
- B07 still owns cross-process queue/cursor reconciliation and valid-request
  operational atomicity. Queue plus quarantine are crash-safe ordered files,
  not a single transaction.
- Server-first rollout is mandatory for a new Agent. Agent manifest pinning,
  version/tag publication, installer delivery, production deploy and production
  canary are separate release gates and were not changed or exercised here.
- No state files, human gate decision, original worktree, branch push or
  production resource was modified.

Protocol details and failure ordering are in
`docs/specs/B06-usage-partial-ack-quarantine-slice-20261008.md`.
