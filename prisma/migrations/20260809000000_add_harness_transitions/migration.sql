-- BL-TRANSITION-LOG F001：状态流转事件表。report 入库事务内 diff 新旧 status/batch 追加，
-- 纯 additive（新表 + 索引 + 外键），对既有数据零影响，可安全滚动部署。
CREATE TABLE "HarnessTransition" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "harnessProjectId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "fromBatch" TEXT,
    "toBatch" TEXT,
    "batchBoundary" BOOLEAN NOT NULL DEFAULT false,
    "fixRounds" INTEGER NOT NULL DEFAULT 0,
    "headSha" TEXT,
    "observedAfter" TIMESTAMP(3),
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HarnessTransition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HarnessTransition_userId_idx" ON "HarnessTransition"("userId");
CREATE INDEX "HarnessTransition_harnessProjectId_observedAt_idx" ON "HarnessTransition"("harnessProjectId", "observedAt");
CREATE INDEX "HarnessTransition_toBatch_idx" ON "HarnessTransition"("toBatch");

ALTER TABLE "HarnessTransition" ADD CONSTRAINT "HarnessTransition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HarnessTransition" ADD CONSTRAINT "HarnessTransition_harnessProjectId_fkey" FOREIGN KEY ("harnessProjectId") REFERENCES "HarnessProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
