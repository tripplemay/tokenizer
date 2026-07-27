-- CreateTable
CREATE TABLE "HarnessModeIntent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "harnessProjectId" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signature" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "issuedBy" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "intentExpiresAt" TIMESTAMP(3) NOT NULL,
    "relayedAt" TIMESTAMP(3),
    "stagedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "appliedBatch" TEXT,
    "stagedCommitSha" TEXT,
    "failureCode" TEXT,
    "failureDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HarnessModeIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HarnessDispatchRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "harnessProjectId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "batch" TEXT NOT NULL,
    "feature" TEXT,
    "role" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "modelFamily" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "lockedSha" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "exitCode" INTEGER,
    "verdict" TEXT,
    "artifactPath" TEXT,
    "artifactSha256" TEXT,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HarnessDispatchRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HarnessModeIntent_harnessProjectId_intentId_key" ON "HarnessModeIntent"("harnessProjectId", "intentId");

-- CreateIndex
CREATE INDEX "HarnessModeIntent_userId_idx" ON "HarnessModeIntent"("userId");

-- CreateIndex
CREATE INDEX "HarnessModeIntent_harnessProjectId_status_idx" ON "HarnessModeIntent"("harnessProjectId", "status");

-- CreateIndex
CREATE INDEX "HarnessModeIntent_intentExpiresAt_idx" ON "HarnessModeIntent"("intentExpiresAt");

-- CreateIndex
CREATE INDEX "HarnessModeIntent_issuedAt_idx" ON "HarnessModeIntent"("issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HarnessDispatchRun_harnessProjectId_runId_key" ON "HarnessDispatchRun"("harnessProjectId", "runId");

-- CreateIndex
CREATE INDEX "HarnessDispatchRun_userId_idx" ON "HarnessDispatchRun"("userId");

-- CreateIndex
CREATE INDEX "HarnessDispatchRun_harnessProjectId_startedAt_idx" ON "HarnessDispatchRun"("harnessProjectId", "startedAt");

-- CreateIndex
CREATE INDEX "HarnessDispatchRun_batch_idx" ON "HarnessDispatchRun"("batch");

-- CreateIndex
CREATE INDEX "HarnessDispatchRun_outcome_idx" ON "HarnessDispatchRun"("outcome");

-- AddForeignKey
ALTER TABLE "HarnessModeIntent" ADD CONSTRAINT "HarnessModeIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HarnessModeIntent" ADD CONSTRAINT "HarnessModeIntent_harnessProjectId_fkey" FOREIGN KEY ("harnessProjectId") REFERENCES "HarnessProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HarnessDispatchRun" ADD CONSTRAINT "HarnessDispatchRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HarnessDispatchRun" ADD CONSTRAINT "HarnessDispatchRun_harnessProjectId_fkey" FOREIGN KEY ("harnessProjectId") REFERENCES "HarnessProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
