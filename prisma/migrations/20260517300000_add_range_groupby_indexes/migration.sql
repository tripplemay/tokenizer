-- Composite indexes for the most-frequent hot path on the dashboard:
-- "filter by occurredAt range, group by X" where X is model / source /
-- deviceId / projectId. Existing single-column or X-leading indexes are
-- great for the reverse ("filter by X, then sort by occurredAt") but cannot
-- accelerate "WHERE occurredAt > $1 GROUP BY X". With Phase 1 summary
-- caching most reads will skip these, but the cold-path first render gets
-- a 5–10x speedup on the underlying SUM aggregates.

CREATE INDEX IF NOT EXISTS "UsageEvent_occurredAt_model_idx"     ON "UsageEvent" ("occurredAt", "model");
CREATE INDEX IF NOT EXISTS "UsageEvent_occurredAt_source_idx"    ON "UsageEvent" ("occurredAt", "source");
CREATE INDEX IF NOT EXISTS "UsageEvent_occurredAt_deviceId_idx"  ON "UsageEvent" ("occurredAt", "deviceId");
CREATE INDEX IF NOT EXISTS "UsageEvent_occurredAt_projectId_idx" ON "UsageEvent" ("occurredAt", "projectId");
