-- CreateTable
CREATE TABLE "HarnessProject" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "repoKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT,
    "status" TEXT,
    "batch" TEXT,
    "fixRounds" INTEGER NOT NULL DEFAULT 0,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "headSha" TEXT,
    "signoff" TEXT,
    "dashboardUrl" TEXT,
    "autonomyStatus" TEXT,
    "lastHaltCondition" TEXT,
    "lastHaltDetail" TEXT,
    "features" JSONB,
    "reportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HarnessProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HarnessGate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "harnessProjectId" TEXT NOT NULL,
    "gateId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "batch" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "detail" TEXT NOT NULL,
    "evidence" JSONB,
    "raisedAt" TIMESTAMP(3) NOT NULL,
    "raisedBy" TEXT NOT NULL,
    "decisionAction" TEXT,
    "decisionBy" TEXT,
    "decisionAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "decisionOnce" BOOLEAN NOT NULL DEFAULT true,
    "decisionSig" TEXT,
    "relayedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HarnessGate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HarnessProject_userId_idx" ON "HarnessProject"("userId");

-- CreateIndex
CREATE INDEX "HarnessProject_reportedAt_idx" ON "HarnessProject"("reportedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HarnessProject_deviceId_repoKey_key" ON "HarnessProject"("deviceId", "repoKey");

-- CreateIndex
CREATE INDEX "HarnessGate_userId_idx" ON "HarnessGate"("userId");

-- CreateIndex
CREATE INDEX "HarnessGate_decisionAt_idx" ON "HarnessGate"("decisionAt");

-- CreateIndex
CREATE INDEX "HarnessGate_consumedAt_idx" ON "HarnessGate"("consumedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HarnessGate_harnessProjectId_gateId_key" ON "HarnessGate"("harnessProjectId", "gateId");

-- AddForeignKey
ALTER TABLE "HarnessProject" ADD CONSTRAINT "HarnessProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HarnessProject" ADD CONSTRAINT "HarnessProject_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HarnessProject" ADD CONSTRAINT "HarnessProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HarnessGate" ADD CONSTRAINT "HarnessGate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HarnessGate" ADD CONSTRAINT "HarnessGate_harnessProjectId_fkey" FOREIGN KEY ("harnessProjectId") REFERENCES "HarnessProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

