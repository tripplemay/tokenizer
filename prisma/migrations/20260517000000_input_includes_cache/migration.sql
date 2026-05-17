-- Migration: redefine inputTokens to include cache reads (matches OpenAI / Codex
-- convention) and introduce a separate cacheWriteTokens column.

-- 1. Add cacheWriteTokens column with safe default.
ALTER TABLE "UsageEvent" ADD COLUMN "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0;

-- 2. Backfill cacheWriteTokens from rawJson for the two parsers we control.
-- Claude jsonl rows carry the raw API payload under rawJson.message.usage.
UPDATE "UsageEvent"
SET "cacheWriteTokens" = COALESCE(
  (("rawJson" -> 'message' -> 'usage' ->> 'cache_creation_input_tokens')::int),
  0
)
WHERE "source" = 'claude-code'
  AND "sourceEventId" LIKE 'claude-jsonl:%'
  AND "rawJson" IS NOT NULL;

-- OpenCode parser already stores cacheWriteTokens as a top-level rawJson field.
UPDATE "UsageEvent"
SET "cacheWriteTokens" = COALESCE(
  (("rawJson" ->> 'cacheWriteTokens')::int),
  0
)
WHERE "source" = 'opencode'
  AND "rawJson" IS NOT NULL;

-- 3. Upgrade inputTokens semantic to include cache reads. Old rows stored
-- inputTokens as (raw + cache_write); the new convention is
-- (raw + cache_write + cache_read), which matches Codex/OpenAI and lets
-- "Cache hit rate = cachedInputTokens / inputTokens" without a separate
-- denominator.
UPDATE "UsageEvent"
SET "inputTokens" = "inputTokens" + "cachedInputTokens";
