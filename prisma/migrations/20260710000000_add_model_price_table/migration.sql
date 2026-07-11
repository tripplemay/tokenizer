-- Global auto-pricing overlay for the static MODEL_PRICES seed.
--
-- Deliberately NOT tenant-scoped (no userId): a model's published list price is
-- the same for every user, so we keep one global row per normalized model key
-- (= normalizeModelKey output: lowercase, trimmed, trailing -YYYYMMDD stripped).
--
-- The static seed in src/shared/model-pricing.ts stays the fallback; this table
-- fills keys the seed lacks. Only rows with status IN ('auto_applied','approved')
-- are treated as billable by src/server/model-prices.ts getEffectivePrices();
-- every other status is tracked but never changes a reported cost, preserving
-- the "unpriced beats a guessed price" contract until a trusted source or a
-- human confirms it. All four unit prices are USD per 1M tokens.
CREATE TABLE "ModelPrice" (
    "id" TEXT NOT NULL,
    "modelKey" TEXT NOT NULL,
    "input" DECIMAL(14,8),
    "cacheRead" DECIMAL(14,8),
    "cacheWrite" DECIMAL(14,8),
    "output" DECIMAL(14,8),
    "status" TEXT NOT NULL DEFAULT 'detected',
    "source" TEXT,
    "sourceUrl" TEXT,
    "confidence" TEXT,
    "rawLookup" JSONB,
    "notes" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pricedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelPrice_pkey" PRIMARY KEY ("id")
);

-- One global row per normalized model key; detection upserts on this key.
CREATE UNIQUE INDEX "ModelPrice_modelKey_key" ON "ModelPrice"("modelKey");

-- The review queue and getEffectivePrices() both filter by status.
CREATE INDEX "ModelPrice_status_idx" ON "ModelPrice"("status");
