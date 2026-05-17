-- Diagnostic columns pushed by the agent via the heartbeat payload. All
-- nullable so existing rows from before this migration stay valid; older
-- clients that don't send the diagnostics block simply leave them null.
ALTER TABLE "Device" ADD COLUMN "agentVersion" TEXT;
ALTER TABLE "Device" ADD COLUMN "queueDepth" INTEGER;
ALTER TABLE "Device" ADD COLUMN "lastError" TEXT;
ALTER TABLE "Device" ADD COLUMN "lastErrorAt" TIMESTAMP(3);
ALTER TABLE "Device" ADD COLUMN "lastSyncStatus" TEXT;
