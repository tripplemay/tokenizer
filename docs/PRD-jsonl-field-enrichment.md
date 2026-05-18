# PRD — JSONL Field Enrichment (A1)

Status: ready for implementation
Owner: TBD
Phase: 1 (parallelizable with PRD-quota-snapshot)

## 1. Background

Tokenizer currently parses Claude Code's `~/.claude/projects/**/*.jsonl` and Codex/OpenCode equivalents to capture per-message token usage. Investigation against openusage's `internal/providers/claude_code` (a comparable open-source dashboard) shows our Claude parser drops several billing-relevant fields that the JSONL file actually contains. Users have reported that openusage shows usage detail we cannot. The data is already in the file we read; we just don't extract it.

This PRD addresses the Claude parser. Codex and OpenCode parsers already extract everything their files expose; no change there.

## 2. Goal

Bring `src/parsers/claude.ts` to parity with the data Claude Code writes to JSONL, so the server captures every cost-affecting field at ingestion time. Dashboard surfaces are out of scope here — this PRD lands the data; downstream tickets render it.

## 3. Out of scope

- Dashboard widgets / aggregation queries for the new fields. Data is captured for future use.
- Codex / OpenCode parsers. Their files don't expose these fields.
- Cost recomputation. New columns are additive; existing cost math stays untouched.
- Backfill of historical events. Old events truly didn't capture this data; defaults of 0 / NULL are semantically correct.

## 4. Fields to add

Source: `assistant` rows in `~/.claude/projects/**/*.jsonl`. All fields live under `message.usage` unless noted.

| Field in JSONL | DB column | Type | Default | Notes |
|---|---|---|---|---|
| `usage.cache_creation.ephemeral_5m_input_tokens` | `cacheEphemeral5mInputTokens` | Int | 0 | Subset of `cache_creation_input_tokens`. Claude 4.x feature. |
| `usage.cache_creation.ephemeral_1h_input_tokens` | `cacheEphemeral1hInputTokens` | Int | 0 | Subset of `cache_creation_input_tokens`. Claude 4.x feature. |
| `usage.server_tool_use.web_search_requests` | `webSearchRequests` | Int | 0 | Billed per request, not per token. |
| `usage.server_tool_use.web_fetch_requests` | `webFetchRequests` | Int | 0 | Billed per request. |
| `usage.service_tier` | `serviceTier` | String? | NULL | Values seen in the wild: `"standard"`, `"priority"`, `"batch"`. Free-form; do not enum. |

Invariant: `cacheEphemeral5mInputTokens + cacheEphemeral1hInputTokens ≤ cacheWriteTokens`. The two ephemeral counters are a breakdown of an already-captured total; `cacheWriteTokens` continues to hold `usage.cache_creation_input_tokens` verbatim for backward compatibility.

### Note on reasoning tokens

openusage's parser reads `ReasoningTokens` for Claude. Our `parsers/claude.ts` does not. However, Anthropic's public JSONL shape does not consistently emit `usage.output_tokens_details.reasoning_tokens` for Claude Code conversations as of writing. **Implementation step before coding**: grep a recent `~/.claude/projects/**/*.jsonl` for `reasoning` to confirm whether the field is present. If yes, add `reasoningOutputTokens` extraction (column already exists in `UsageEvent`). If no, skip and note in the PR that this is a deferred follow-up.

## 5. Schema migration

New Prisma migration adding to `UsageEvent`:

```prisma
model UsageEvent {
  // ... existing fields ...
  cacheEphemeral5mInputTokens Int     @default(0)
  cacheEphemeral1hInputTokens Int     @default(0)
  webSearchRequests           Int     @default(0)
  webFetchRequests            Int     @default(0)
  serviceTier                 String?
}
```

Migration is forward-only. No data backfill. `prisma migrate dev` to generate the file; the deploy path is `prisma migrate deploy`.

## 6. Code changes

### 6.1 `src/shared/usage.ts`

Extend `UsageEventInput` with five optional fields matching the new columns:

```ts
cacheEphemeral5mInputTokens?: number;
cacheEphemeral1hInputTokens?: number;
webSearchRequests?: number;
webFetchRequests?: number;
serviceTier?: string | null;
```

All optional so old agents still validate against the server.

### 6.2 `src/parsers/claude.ts`

In `parseProjectJsonl`, after extracting existing `cacheCreation`/`cacheRead`:

```ts
const cacheCreationDetail = (usage.cache_creation ?? {}) as Record<string, unknown>;
const cacheEphemeral5m = normalizeTokenCount(cacheCreationDetail.ephemeral_5m_input_tokens);
const cacheEphemeral1h = normalizeTokenCount(cacheCreationDetail.ephemeral_1h_input_tokens);

const serverToolUse = (usage.server_tool_use ?? {}) as Record<string, unknown>;
const webSearchRequests = normalizeTokenCount(serverToolUse.web_search_requests);
const webFetchRequests = normalizeTokenCount(serverToolUse.web_fetch_requests);

const serviceTier = typeof usage.service_tier === "string" ? usage.service_tier : null;
```

Then add them to the `events.push({ ... })` payload.

Do not touch `parseLegacySessionMeta` — the legacy session-meta files don't carry these fields.

### 6.3 Server ingestion validator

The server route that receives `/api/usage/events/batch` must accept the new fields and pass them through to Prisma. Locate the route (likely `app/api/usage/events/batch/route.ts` or similar) and:
- Add the five fields to the request body schema / zod validator
- Add them to the `createMany` payload mapping
- Defaults match Prisma column defaults (0 / NULL)

Old agents that don't send these fields must continue to work — every field is optional with a safe default.

## 7. Tests

Vitest, under `tests/`:

1. **Parser test** — feed a synthetic JSONL line that includes `cache_creation.ephemeral_5m_input_tokens: 100`, `cache_creation.ephemeral_1h_input_tokens: 50`, `server_tool_use.web_search_requests: 2`, `service_tier: "priority"`. Assert all five fields appear correctly on the resulting `UsageEventInput`.
2. **Backward compat test** — feed a JSONL line missing all five fields (i.e. the current real-world shape from before the Claude 4.x cache tier). Assert defaults of `0 / 0 / 0 / 0 / null`.
3. **Invariant test** — assert `cacheEphemeral5m + cacheEphemeral1h ≤ cacheWriteTokens` whenever the input JSONL has consistent data. (Should hold; log a warning in the parser if not, but don't fail the line.)

Server route test: extend the existing batch-ingest test (if present) to verify the new columns persist; otherwise add a minimal one.

## 8. Acceptance criteria

- `npm run test` passes including the new tests.
- `npm run cli -- collect` on a real `~/.claude/projects` containing recent Claude 4.x conversations produces at least one event with `cacheEphemeral5mInputTokens > 0` OR `cacheEphemeral1hInputTokens > 0`. (If the developer's local data is older than Claude 4.x, snapshot a sample JSONL into `tests/fixtures/` and verify there instead.)
- `prisma migrate dev` runs cleanly on a fresh DB.
- Existing UsageEvent aggregations (totals, per-project, per-model) return identical numbers before and after the migration for unchanged data.

## 9. Risks

- **Old clients sending no values for new fields**: handled by `Int @default(0)` and `String?`. No-op.
- **Future Claude API shape changes**: openusage uses identical field paths; if Anthropic renames, we and they break together. Acceptable.
- **Invariant violation in real data**: parser should not throw. Log a warning via the existing `warnings: string[]` return channel.

## 10. Handoff notes for implementer

1. Read `src/parsers/claude.ts:73-120` (the `parseProjectJsonl` function) before editing — it's the only function to change in the parser.
2. The Prisma client must be regenerated after migration: `npm run prisma:generate`.
3. The server batch route's exact path is in `app/api/` — find it with `grep -r "events/batch" app/`.
4. The cursor / dedup logic in `recordFile` / `shouldSkipFile` does NOT need touching. The new fields are added per-event, not per-file.
