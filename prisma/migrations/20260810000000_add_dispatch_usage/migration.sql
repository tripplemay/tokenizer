-- BL-DISPATCH-USAGE-CAPTURE F003：HarnessDispatchRun 增派发用量列。
-- 纯 additive（8 个可空列），对既有数据零影响，可安全滚动部署。
ALTER TABLE "HarnessDispatchRun" ADD COLUMN "usageModel" TEXT;
ALTER TABLE "HarnessDispatchRun" ADD COLUMN "usageInputTokens" INTEGER;
ALTER TABLE "HarnessDispatchRun" ADD COLUMN "usageCachedInputTokens" INTEGER;
ALTER TABLE "HarnessDispatchRun" ADD COLUMN "usageCacheWriteTokens" INTEGER;
ALTER TABLE "HarnessDispatchRun" ADD COLUMN "usageOutputTokens" INTEGER;
ALTER TABLE "HarnessDispatchRun" ADD COLUMN "usageReasoningTokens" INTEGER;
ALTER TABLE "HarnessDispatchRun" ADD COLUMN "usageTurns" INTEGER;
ALTER TABLE "HarnessDispatchRun" ADD COLUMN "usageCapture" TEXT;
