-- Latest bounded Harness transport-health snapshot reported by agent v5.
-- Nullable with no backfill: older agents omit the field and preserve any
-- last-known value already stored for the device.
ALTER TABLE "Device" ADD COLUMN "lastHarnessSyncAt" TIMESTAMP(3);
ALTER TABLE "Device" ADD COLUMN "harnessSyncStatus" TEXT;
ALTER TABLE "Device" ADD COLUMN "harnessDiagnostics" JSONB;
