-- Capture Claude-Code JSONL fields that we currently drop on the floor.
-- All forward-only / safe defaults; existing rows and old clients unaffected.

ALTER TABLE "UsageEvent" ADD COLUMN "cacheEphemeral5mInputTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UsageEvent" ADD COLUMN "cacheEphemeral1hInputTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UsageEvent" ADD COLUMN "webSearchRequests" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UsageEvent" ADD COLUMN "webFetchRequests" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UsageEvent" ADD COLUMN "serviceTier" TEXT;
