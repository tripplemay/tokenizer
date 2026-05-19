-- Append-only history of subscription quota snapshots fetched from
-- third-party APIs (chatgpt.com/backend-api, future Claude Web). "Latest"
-- is derived on read via DISTINCT ON (provider, windowKey).

CREATE TABLE "QuotaSnapshot" (
  "id"            TEXT PRIMARY KEY,
  "userId"        TEXT NOT NULL,
  "provider"      TEXT NOT NULL,
  "accountKey"    TEXT NOT NULL,
  "windowKey"     TEXT NOT NULL,
  "utilization"   DECIMAL(6,4),
  "usedRaw"       BIGINT,
  "limitRaw"      BIGINT,
  "unit"          TEXT,
  "resetsAt"      TIMESTAMP(3),
  "capturedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "capturedBy"    TEXT,
  "rawJson"       JSONB,
  CONSTRAINT "QuotaSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "QuotaSnapshot_capturedBy_fkey" FOREIGN KEY ("capturedBy") REFERENCES "Device"("id") ON DELETE SET NULL
);

CREATE INDEX "QuotaSnapshot_userId_provider_windowKey_capturedAt_idx"
  ON "QuotaSnapshot" ("userId", "provider", "windowKey", "capturedAt");
