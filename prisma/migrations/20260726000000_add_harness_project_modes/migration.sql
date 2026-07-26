-- 模式指纹（P1）。纯增量、可空：老 agent 不上报这一列时行为不变。
ALTER TABLE "HarnessProject" ADD COLUMN "modes" JSONB;
