-- BL-TRANSITION-LOG F004：批次归档表（吸收自 BL-PERF-ANALYTICS F001）。
-- 纯 additive（新表 + 索引 + 外键），对既有数据零影响，可安全滚动部署。
CREATE TABLE "HarnessBatchArchive" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "harnessProjectId" TEXT NOT NULL,
    "repoKey" TEXT NOT NULL,
    "batch" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fixRounds" INTEGER NOT NULL DEFAULT 0,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "headSha" TEXT,
    "signoff" TEXT,
    "dashboardUrl" TEXT,
    "features" JSONB,
    "firstPass" BOOLEAN NOT NULL DEFAULT false,
    "archivedReason" TEXT NOT NULL,
    "doneAt" TIMESTAMP(3),
    "reportedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HarnessBatchArchive_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HarnessBatchArchive_harnessProjectId_batch_key" ON "HarnessBatchArchive"("harnessProjectId", "batch");
CREATE INDEX "HarnessBatchArchive_userId_idx" ON "HarnessBatchArchive"("userId");
CREATE INDEX "HarnessBatchArchive_doneAt_idx" ON "HarnessBatchArchive"("doneAt");

ALTER TABLE "HarnessBatchArchive" ADD CONSTRAINT "HarnessBatchArchive_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HarnessBatchArchive" ADD CONSTRAINT "HarnessBatchArchive_harnessProjectId_fkey" FOREIGN KEY ("harnessProjectId") REFERENCES "HarnessProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
