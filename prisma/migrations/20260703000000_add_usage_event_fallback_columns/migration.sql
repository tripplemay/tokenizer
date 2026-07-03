-- Mid-request model fallback attribution (e.g. claude-fable-5 downgrading to
-- claude-opus-4-8 mid-stream). The final event carries "fallbackFromModel",
-- the abandoned-segment event carries "fallbackToModel". Nearly always NULL,
-- so no dedicated index: dashboard queries filter by the existing
-- (userId, occurredAt) indexes first.
ALTER TABLE "UsageEvent" ADD COLUMN "fallbackFromModel" TEXT;
ALTER TABLE "UsageEvent" ADD COLUMN "fallbackToModel" TEXT;
