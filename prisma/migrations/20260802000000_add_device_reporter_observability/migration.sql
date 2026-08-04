-- The diagnostics source is recorded only when a heartbeat reporter passes
-- the monotonic version guard. This lets operators distinguish a stale agent
-- that is still alive from the reporter whose diagnostics are authoritative.
ALTER TABLE "Device" ADD COLUMN "reporterTokenPrefix" TEXT;
ALTER TABLE "Device" ADD COLUMN "reportedAt" TIMESTAMP(3);

CREATE INDEX "Device_reportedAt_idx" ON "Device"("reportedAt");
