# B06 bounded server admission slice

This is an isolated upgrade candidate, not a full B06 closeout or release approval.
It changes only `POST /api/usage/events/batch` and
`POST /api/quota/snapshots/batch`, plus a shared server-only validator.

## Ordering and response contract

1. Authenticate the device token by read-only lookup. Missing/revoked credentials
   remain 401. Verify the token's device exists and belongs to its user (403).
2. Read the actual request byte stream, limiting it before JSON.parse; validate
   UTF-8, JSON shape and complexity. Content-Length is only an early rejection
   hint, never permission to consume more bytes.
3. Validate the entire batch and all rows. Check an explicitly supplied device
   against the authenticated device (403).
4. Only then update timezone, device/token diagnostics, project/event/snapshot
   persistence, cache or pricing state through the existing ingest paths.

Any invalid row rejects the WHOLE batch with HTTP 400:
`{"error":"invalid batch request","code":"invalid_event","row":1}`.
Row indices are zero-based; envelope/JSON failures omit row. Codes are fixed:
`invalid_json`, `body_too_large`, `invalid_content_type`, `invalid_batch`,
`batch_too_large`, `invalid_device`, `invalid_timezone`, `invalid_event`,
`invalid_snapshot`, `invalid_raw_json`. No values, exception messages, credentials
or raw payload fragments are echoed. Invalid JSON/UTF-8/stream failures are safe
400, not thrown route errors. This is not a partial ACK and never a rejected-row
200 response: old Agents throw on non-2xx and preserve the unacknowledged queue.

Authentication DB reads are allowed before validation. Invalid requests perform
no timezone/device/token/project/event/quota/cache/pricing writes. This does NOT
make a valid request atomic against later operational DB/pricing failures; the
existing ingest transaction/outbox model is unchanged (future B07).

## Exact bounds

| Input | Bound / rule |
| --- | --- |
| Body | application/json; <= 1,048,576 actual UTF-8 bytes; malformed or over-limit declared length rejected |
| JSON complexity | depth <= 32 (root depth 0), <= 100,000 visited values; finite numbers; no NUL/unpaired surrogate in keys or strings |
| Row count | usage <= 200; quota <= 100; valid empty arrays remain 200 |
| rawJson / device.metadata | <= 65,536 serialized UTF-8 bytes, depth <= 8 |
| Device | id/name nonblank <= 200; hostname <= 255, platform <= 100 |
| Usage source | exactly claude-code, codex, opencode, aider, kimicode |
| Usage identity | sourceEventId nonblank <= 2048; unchanged identity/canonicalization logic |
| Optional usage strings | projectName 200, sessionId 512, workspacePath/localWorkspacePath 4096, repoKey 2048, gitRemote 4096, gitBranch 512, gitCommit 128, model 256, serviceTier 100, fallbackFromModel/fallbackToModel 256 |
| Typed strings | actual strings, bounded UTF-16 length; no C0/C1 control characters; optional legacy null allowed |
| Usage token counts | actual finite, safe, nonnegative integers <= 2,147,483,647 (PostgreSQL Int); omitted allowed, null/string/fraction rejected |
| Fallback total | if totalTokens is omitted/zero, inputTokens + outputTokens must fit PostgreSQL Int |
| Codex cumulative identity counters | when present in rawJson.payload.info.total_token_usage, six known counters are nonnegative safe integers <= Number.MAX_SAFE_INTEGER |
| Usage costUsd | omitted/null or finite numeric 0 <= value < 10,000,000,000 (Decimal(18,8)) |
| UTC dates | YYYY-MM-DDTHH:mm:ss[.S/SS/SSS]Z, valid calendar round-trip, years 0001..9999; no offsets, rollover, date-only or invalid leap day |
| Timezone | optional nonblank string <= 64 and accepted by Intl timeZone validation |
| Diagnostics | optional object; agentVersion/releaseVersion <= 128, lastError <= 2048; nullable legacy fields preserved; featureVersion <= shared MAX_AGENT_FEATURE_VERSION, queueDepth <= PostgreSQL Int, success/failed/null sync status; existing strict Harness parser |
| Quota provider | exactly codex-chatgpt, the sole registered current provider |
| Quota identity/unit | accountKey nonblank <= 256; windowKey nonblank <= 200; optional/null unit <= 100 |
| Quota utilization | omitted/null or finite numeric 0..1 (not percent 0..100) |
| Quota usedRaw/limitRaw | omitted/null or nonnegative safe JSON integer <= 9,007,199,254,740,991; exact BigInt conversion, no rounding |
| Quota resetsAt | omitted/null or valid UTC date as above |

Unknown additive fields are permitted only within the global body/JSON bounds;
existing explicit mappings do not trust userId/deviceId/capturedBy supplied by
rows. Usage's existing B03 minimizer remains authoritative: no new source
content is persisted. Existing bounded quota rawJson persistence is unchanged.

## Compatibility evidence and deliberate incompatibilities

- Current usage Agent (`src/cli/sync.ts`) sends 25-row JSON batches, includes
  device, UTC occurredAt, timezone and nullable diagnostics, and uses the existing
  privacy minimizer. The validator does not modify sourceEventId/cursors/wire
  identity. Nullable scalar fields and omitted optional counts remain valid.
- Current quota Agent (`src/quota/sync.ts`) sends `{snapshots}` without device;
  this remains valid, bound to the token's device. `src/quota/types.ts` declares
  utilization 0..1; the actual provider divides used_percent by 100 (35.5 ->
  0.355, 83 -> 0.83), and emits omitted utilization for label/credit rows.
- `batch-wire-compatibility.test.ts` validates actual provider output from the
  existing synthetic response fixture and actual usage privacy-minimizer output.
  Real PG16 probes exercise Int/Decimal/BigInt bounds, real token authentication,
  tenant binding, privacy minimization, malformed mixed rows and revocation.
- Previously accepted unknown sources, coercible token strings, fractional
  BigInt inputs, impossible dates, invalid control-character strings, oversized
  batches/raw content and non-UTC date representations are deliberately rejected.
  The old F003 poison-2xx expectation is updated, not treated as compatibility.

## Explicit remaining blockers

Client poison-row quarantine, explicit rejected IDs / partial ACK protocol,
isolation of bad rows from good queued rows, and user-visible repair/replay are
NOT implemented. A poisoned batch can still pin its good neighbours until
explicit repair; whole-batch 400 prevents silent loss but does not solve queue
liveness. Full B06 remains blocked on a separately versioned client/protocol
slice. No client production code, pricing outbox (B07), schema/migration, release
manifest, CI workflow, historical evidence, production data cleanup or state/gate
files are changed here. Fresh independent evaluation and native CI remain pending.
