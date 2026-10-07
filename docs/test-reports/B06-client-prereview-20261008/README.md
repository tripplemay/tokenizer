# B06 client partial ACK: same-family technical prereview

Candidate is **exactly** `694ff3c7f61664754e88d50f3161fc5d06ac6607` in a separate detached worktree. Base is `029f6c53ea7193989643a1f2e4d23108ba0c9af5`. This is a fresh-context, same-model-family technical prereview, **not** the harness's different-family formal Evaluator, signoff, gate decision or release approval. Only this directory was added; no product, state-machine, gate or main-worktree file was modified or pushed.

## Outcome

**BLOCK combined B06 client release.** The candidate's single-writer partial ACK works for the tested path, including real PostgreSQL 16 and a TCP HTTP roundtrip to the route. But concurrent `collect`/`sync` can silently and permanently discard a newly queued event; the new long-lived quarantine file is `0644` under umask `022`. The advertised fallback to the immediately preceding B06 server also fails for a rowless `invalid_json` 400. These are distinct from the single-process accepted/rejected partition logic. The queue race is already designated B07 work, but a combined deployment cannot ignore actual data loss on a supported CLI interleaving.

### B06-PRE-01: two-process ACK checkpoint loses a new row (release blocker)

`syncEvents` snapshots and sorts the caller's array (`src/cli/sync.ts:189-193`), then after a valid ACK removes that batch and calls `onBatchSynced(remaining)` (`src/cli/sync.ts:216-233`). Both `runOnce` and `sync` implement the callback as whole-file `writeQueue(remaining)` and then unconditionally `clearQueue()` (`src/cli/agent.ts:83-87`, `src/cli/index.ts:100-106`). The per-operation queue lock does not span request/ACK/checkpoint. `collect` independently reads, writes and advances the parser cursor (`src/cli/index.ts:84-90`). The long-lived agent lock protects only `agent` vs `agent`, not `collect`/`run`/`sync` commands.

Deterministic two-process probe (`two-process-queue-loss.probe.ts`): P1 sends `[good, poison]` over real localhost HTTP; while its request is in flight, the HTTP fixture starts P2, which executes the collector's `readQueue()` + dedupe + `writeQueue()` with `newly-collected`. P2 exits after the queue visibly contains `[good, poison, newly-collected]`. P1 then receives a valid `usage-partial-v1` ACK for good/rejection for poison and checkpoints. Observed output:

```json
{
  "requests": [["good", "poison"]],
  "finalIds": [],
  "quarantinedIds": ["poison"],
  "queueRaw": ""
}
```

`newly-collected` was never sent or quarantined. The actual `collect` path also advances its cursor after writing, so the unchanged source need not be re-emitted. A fix must reconcile only resolved IDs with the **current** queue under its lock; final unconditional clear and cursor/write coordination also need coverage. Merely locking each entire-file write or testing two concurrent quarantine writers does not fix this.

### B06-PRE-02: new retained quarantine is other-readable (privacy blocker)

`quarantineUsageEvents` stores minimized/sanitized events, but still retains `sourceEventId`, `workspacePath`, `localWorkspacePath`, session and project metadata (`src/cli/rejected-events.ts:31-55`, `src/shared/usage-privacy.ts`). Its atomic writer creates a temporary file with `openSync(temp, "w")` and renames it without a restrictive mode (`src/cli/atomic-file.ts:49-70`); `mkdirSync` similarly uses the process umask. Under ordinary umask `022`, the probe obtained `.tokenizer` mode `0755` and `rejected-usage.jsonl` mode `0644`, with `otherTraversableAndReadable=true` in a traversable home fixture. The home-directory mode can reduce exposure on a particular host; it is not guaranteed by this implementation. Existing queue files share this mechanism, but B06 adds a potentially indefinite-retention file. Use restrictive file/directory permissions including atomic replacement and Windows ACL verification before client rollout.

### B06-PRE-03: preceding B06 server's rowless 400 pins a good neighbor (conditional compatibility blocker)

The immediately preceding B06 route calls `readBoundedBatchJson(request)` without row localization; the candidate server opts into row localization only with `usage-partial-v1` (`app/api/usage/events/batch/route.ts:18-33`). A row containing an isolated surrogate in `model` is still JSON-serializable but fails bounded JSON traversal. The old default returns `400 {"code":"invalid_json"}` without `row`; the new option returns the same code with `row:1`. The Agent's fallback requires a recognized code **and** a row (`src/cli/sync.ts:200-214`). The probe observed one request, error `Sync failed: 400 invalid_json`, queue `[good,poison]`, no quarantine. A strict **server-first** deployment avoids this particular old-server gap. Do not claim arbitrary permanent poison-row fallback against the prior server.

## Positive checks and boundaries

- Current server: explicit `usage-partial-v1` response, accepted index + source + sourceEventId, unique complete accepted/rejected partition and `received == accepted.length` are checked before queue mutation (`src/cli/sync.ts:145-174`). Missing/forged ACK tests remain green. A legacy 2xx without any partial fields is interpreted as full ACK, hence server-first is a hard rollout condition, not a fail-closed negotiation.
- Current route: envelope/device/timezone validated before side effects; invalid usage rows excluded; all-rejected nonempty request skips timezone/device/token/event writes; valid empty request retains heartbeat semantics (`src/server/batch-input.ts:174-205`, `app/api/usage/events/batch/route.ts:22-44`). Actual isolated PG16/TCP probe recorded 2 accepted neighbors, 1 rejection, 2 duplicate replay results, and an all-rejected response with DB state unchanged. The route's cache invalidation emitted a known warning because this probe invokes the route outside Next's request context; HTTP status and DB assertions still passed.
- HTTP classes: 400/401/403 and other non-listed 4xx fail immediately; 408/425/429/5xx and transport exceptions get at most two additional attempts after 5s/15s (`src/cli/sync.ts:74-84`). Previous B06 row-scoped 400 fallback works for `invalid_event`/`invalid_raw_json`, as existing tests show, subject to the rowless exception above.
- B03 semantics: `local-only` and `paused` block upload. Previously admitted local-only backlog is retained, then automatically uploaded after switching to `sync`, even when include/exclude rules changed (`src/cli/agent.ts:63-85`, `src/cli/sync.ts:177-189`). Focused B03 tests passed. This is an explicit existing product semantic, not a B06 re-filter or retroactive deletion rule; the CLI does describe the automatic upload.
- Privacy minimization strips non-Codex raw JSON and narrows Codex raw JSON to cumulative counters; git userinfo is sanitized before queue/quarantine persistence. The permission finding is independent of those positive transforms.
- Resource bounds are asymmetric: server caps body at 1 MiB, usage rows at 200, raw JSON at 64 KiB/depth 8; Agent sends 25 per batch. But active queue and quarantine files have no total count/byte cap. Each rejection merge parses and rewrites the entire quarantine (`src/cli/rejected-events.ts:39-55`), so many sequential batches incur quadratic aggregate I/O; `status` reads the whole file. No load/soak bound was validated.
- `writeFileAtomic` uses temp-write + rename but no file or directory `fsync` (`src/cli/atomic-file.ts:49-71`). The observed checkpoint ordering is process-crash safe in the tested model, **not** a demonstrated power-loss durability guarantee. B07's multi-writer and operational transaction concerns remain open.

## Verification and replay

Isolated native PostgreSQL 16.13 (UTC), fresh scratch database, 28 migrations: existing candidate PG probes **4/4 passed**. This prereview's `pg16-http-roundtrip.probe.ts` uses actual localhost TCP HTTP, real route/authentication and PostgreSQL (not a full Next.js deployment); mixed rows, idempotent replay and reject-only write-free snapshot passed. Focused portable tests: **39/39 passed** across B06 partial ACK/server/quarantine concurrency and B03 privacy/queue suites. Node was `v22.22.0`; dependencies were symlinked to main checkout's existing `node_modules`, **not** a fresh `npm ci`.

From this worktree, with `node_modules` available (for the recorded run an ignored, temporary symlink to the main checkout's existing dependencies was used and then removed; alternatively use a clean `npm ci`):

```bash
ln -s /Volumes/ORICO/project/tokenizer/node_modules node_modules
NODE=/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin/node
$NODE node_modules/tsx/dist/cli.mjs docs/test-reports/B06-client-prereview-20261008/two-process-queue-loss.probe.ts
$NODE node_modules/tsx/dist/cli.mjs docs/test-reports/B06-client-prereview-20261008/quarantine-permissions.probe.ts
$NODE node_modules/tsx/dist/cli.mjs docs/test-reports/B06-client-prereview-20261008/prior-b06-invalid-json.probe.ts
$NODE node_modules/vitest/vitest.mjs run tests/cli/b06-partial-ack.test.ts tests/cli/b06-rejected-events-concurrency.test.ts tests/server/b06-partial-ack.test.ts tests/cli/privacy.test.ts tests/cli/agent-sync-checkpoint.test.ts tests/cli/privacy-admission-cli.test.ts tests/cli/sync-retry.test.ts
```

For a clean PG16 scratch replay (use an unused port), create the cluster/database and apply migrations first:

```bash
PG=/opt/homebrew/opt/postgresql@16/bin
SCRATCH=$(mktemp -d /tmp/tokenizer-b06-prereview-pg.XXXXXX)
$PG/initdb -D "$SCRATCH/data" -A trust --username=tokenizer_probe --no-instructions
$PG/pg_ctl -D "$SCRATCH/data" -l "$SCRATCH/postgres.log" -o '-h 127.0.0.1 -p 55441 -c TimeZone=UTC' -w start
$PG/createdb -h 127.0.0.1 -p 55441 -U tokenizer_probe tokenizer_b06_prereview_scratch
DATABASE_URL=postgresql://tokenizer_probe@127.0.0.1:55441/tokenizer_b06_prereview_scratch $NODE node_modules/prisma/build/index.js migrate deploy
```

Then run the PG tests and HTTP probe, and stop the scratch cluster:

```bash
DATABASE_URL=postgresql://tokenizer_probe@127.0.0.1:55441/tokenizer_b06_prereview_scratch EVAL_B06_DB_URL=postgresql://tokenizer_probe@127.0.0.1:55441/tokenizer_b06_prereview_scratch TZ=UTC $NODE node_modules/vitest/vitest.mjs run tests/server/b06-batch-db.probe.test.ts tests/server/b06-partial-ack-db.probe.test.ts
DATABASE_URL=postgresql://tokenizer_probe@127.0.0.1:55441/tokenizer_b06_prereview_scratch EVAL_B06_DB_URL=postgresql://tokenizer_probe@127.0.0.1:55441/tokenizer_b06_prereview_scratch TZ=UTC $NODE node_modules/tsx/dist/cli.mjs docs/test-reports/B06-client-prereview-20261008/pg16-http-roundtrip.probe.ts
$PG/pg_ctl -D "$SCRATCH/data" -w stop
```

The actual scratch cluster was stopped after validation. The three negative probe stdout artifacts and the PG16 HTTP stdout/stderr artifact are saved beside this report. The code does not touch production. No exact-SHA CI, native Windows, power-cut, full Next middleware or production canary was performed.

Probe SHA-256: `two-process-queue-loss.probe.ts` `a26064cc97e2a2baee597dd398d6b6eb8c6eee4dd841089a3f632e91bd111356`; `quarantine-permissions.probe.ts` `73b1346d33d1b741edf20f132fe9235781516afe2fec27be98d968b13a8f8bb5`; `prior-b06-invalid-json.probe.ts` `f1174ba791f66540aab657f022bb9d9bb04e4f06b3849aab7b7382bce9478d63`; `pg16-http-roundtrip.probe.ts` `1c1a81399c0ec788423fc8541bc740b21293c3816a92c351c3569a5f7d3b0672`.
