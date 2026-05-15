-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostname" TEXT,
    "platform" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- Backfill existing events to a stable local device so deviceId can be required.
INSERT INTO "Device" ("id", "name", "hostname", "platform", "metadata", "lastSeenAt")
VALUES ('dev_local_legacy', 'Local Device', NULL, NULL, '{"legacy":true}'::jsonb, CURRENT_TIMESTAMP);

-- DropIndex
DROP INDEX "UsageEvent_source_sourceEventId_key";

-- AlterTable
ALTER TABLE "UsageEvent" ADD COLUMN "deviceId" TEXT;

-- Backfill
UPDATE "UsageEvent" SET "deviceId" = 'dev_local_legacy' WHERE "deviceId" IS NULL;

-- Make required
ALTER TABLE "UsageEvent" ALTER COLUMN "deviceId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Device_lastSeenAt_idx" ON "Device"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsageEvent_deviceId_source_sourceEventId_key" ON "UsageEvent"("deviceId", "source", "sourceEventId");

-- CreateIndex
CREATE INDEX "UsageEvent_deviceId_occurredAt_idx" ON "UsageEvent"("deviceId", "occurredAt");

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
