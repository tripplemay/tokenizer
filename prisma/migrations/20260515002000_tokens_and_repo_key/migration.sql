-- AlterTable
ALTER TABLE "Project" ADD COLUMN "repoKey" TEXT;

-- AlterTable
ALTER TABLE "Device" ADD COLUMN "lastSyncAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "UsageEvent" ADD COLUMN "localWorkspacePath" TEXT,
ADD COLUMN "repoKey" TEXT,
ADD COLUMN "gitRemote" TEXT,
ADD COLUMN "gitBranch" TEXT,
ADD COLUMN "gitCommit" TEXT;

-- CreateTable
CREATE TABLE "EnrollmentToken" (
    "id" TEXT NOT NULL,
    "label" TEXT,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedById" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrollmentToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_repoKey_key" ON "Project"("repoKey");

-- CreateIndex
CREATE INDEX "Device_lastSyncAt_idx" ON "Device"("lastSyncAt");

-- CreateIndex
CREATE UNIQUE INDEX "EnrollmentToken_tokenHash_key" ON "EnrollmentToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EnrollmentToken_expiresAt_idx" ON "EnrollmentToken"("expiresAt");

-- CreateIndex
CREATE INDEX "EnrollmentToken_usedAt_idx" ON "EnrollmentToken"("usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_tokenHash_key" ON "DeviceToken"("tokenHash");

-- CreateIndex
CREATE INDEX "DeviceToken_deviceId_idx" ON "DeviceToken"("deviceId");

-- CreateIndex
CREATE INDEX "DeviceToken_lastUsedAt_idx" ON "DeviceToken"("lastUsedAt");

-- CreateIndex
CREATE INDEX "DeviceToken_revokedAt_idx" ON "DeviceToken"("revokedAt");

-- CreateIndex
CREATE INDEX "UsageEvent_repoKey_idx" ON "UsageEvent"("repoKey");

-- AddForeignKey
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
