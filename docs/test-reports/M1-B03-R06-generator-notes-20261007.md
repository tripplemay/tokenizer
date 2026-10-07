# M1/B03 R06 privacy-minimization generator notes (2026-10-07)

Base: `2074991717abaf3cb34d9aad894bcd4357fefbc3` in an isolated detached worktree. This is the R06 slice only. R02 Git identity/remote sanitization is a separate candidate (`b7e4cef`) and must be integrated and re-tested before treating B03 as a whole. No production state, historical rows, `progress.json`, gate, or remote branch was changed.

## Implemented slice

- Claude, OpenCode, Aider, and Kimi parser usage events no longer carry source `rawJson`. Codex carries only normalized `payload.info.total_token_usage` counters; the same counters still produce the existing `codex:v2` canonical ID for older queued/agent events. Claude correction fields (model, token counts, fallback, service tier, time, stable source ID) remain scalar event fields.
- An explicit event-field allowlist is applied after parsing/Git enrichment, on every queue write, when reading and atomically rewriting a legacy queue, before each HTTP POST, and again before server persistence. Unknown top-level event properties and non-Codex raw bodies are discarded. Queue read/write/clear share the existing file lock primitive for the migration rewrite.
- New `privacy` config separates `includePaths`/`excludePaths` from `projectRoots` (which remains workspace inference only). Paths must be absolute; exclude wins, and a nonempty include list rejects events without a matching path. Existing config defaults to `mode: sync`, empty include/exclude. `paused` skips a run before parsing/cursor/network; `local-only` collects into the local queue but skips heartbeat, usage sync, quota refresh, and harness sync in the agent cycle. `syncEvents`/heartbeat reject non-sync modes. `tokenizer preview --limit 0..100` works without enrollment, queue/cursor write, or network request, and displays the minimized sample and active path rules.
- Default device diagnostics now send `lastError: null`; detailed exception text remains only in local state/logs because parser errors and server responses can contain input excerpts. A time-bounded diagnostic capture feature is **not** added in this slice.

## Reproduction and observed boundary

1. `npm ci` completed (637 packages; audit advisory count is handled under B02, not this change).
2. `npm run verify`, `npm run lint`, and `npm run build` exited 0.
3. `npm test` exited 0: 107 files passed, 7 skipped; 1468 tests passed, 20 skipped. The suite includes a valid Claude source text/tool-input canary; source parser output, local queue bytes, and mocked HTTP request body do not contain it. A separate Prisma-mock ingest test confirms an older-agent raw body does not appear in the DB row payload or captured error logs. Codex legacy-ID and Claude correction tests remain green. These are synthetic/unit boundaries, **not** a live Next HTTP + PostgreSQL + UI/log canary run.

## Remaining work / release boundary

- Independent evaluator must inspect the exact commit, rerun tests, and exercise a live isolated API + PostgreSQL + UI/log canary with two synthetic tenants. This generator has not signed off B03.
- The preexisting `UsageEvent.rawJson` rows and already-uploaded payloads are untouched. Older deployed agents may still send full raw bodies over HTTP until upgraded, although this server candidate drops them before DB insert/correction. Fleet rollout and old-client acceptance policy need an owner.
- This R06 candidate was cut from the baseline and still contains baseline Git remote handling. Merge R02 `b7e4cef` first or together, then repeat the canary for userinfo/query/fragment and Git identity. Do not infer R02 protection from this diff.
- Identifiers and provenance (`sourceEventId`, workspace/session/project/model, Git fields) remain on the wire. Some legacy source IDs contain absolute paths. Replacing them requires a versioned identity/dedup migration and is not silently done here.
- `local-only` retains a local queued backlog; switching back to `sync` will upload it unless the operator explicitly discards the queue. Pausing does not cancel an already in-flight request. Include/exclude gates persistence/upload, but parsers still scan local source files to find usage; changing include rules after cursor advancement does not replay previously excluded history automatically. These semantics should be reviewed with product/privacy owners before rollout.
- A diagnostic opt-in design remains: explicit local consent with purpose/scope, expiry enforced client and server side (short TTL), no implicit extension, bounded redacted payloads, dedicated retention and audit trail. Until implemented, raw diagnostics are off rather than automatically captured.

## Historical data cleanup proposal only (not executed)

1. Inventory per-tenant/source counts and bytes of non-null `rawJson` in a read-only dry-run; return aggregates and hashed sample IDs, never raw content in the report. Include old client versions and rows whose Codex IDs are not yet canonical.
2. Obtain owner/legal retention approval and freeze the cleanup scope. Take a consistent `pg_dump --format=custom` backup, hash it, restore into an isolated scratch PostgreSQL instance, and verify row counts plus tenant and canonical-ID invariants.
3. In scratch, derive the exact per-source minimal JSON projection using the same allowlist as this candidate; preview update counts/bytes and spot-check synthetic canaries without printing real raw bodies. Codex rows retain only six cumulative counters if present; other sources become JSON null. Verify usage sums, correction behavior, tenant isolation, and UI queries before drafting a production migration.
4. Only after separate human approval, schedule a batched production rewrite with rate/lock limits, observability, backup restore path, and post-run aggregate verification. No cleanup SQL or migration runs as part of this candidate.
