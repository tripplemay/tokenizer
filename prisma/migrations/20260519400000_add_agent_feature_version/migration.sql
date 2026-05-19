-- Numeric agent capability version sent by the client in heartbeats.
-- Nullable so existing rows from before this migration stay valid; old
-- clients that don't send the new field simply leave it null, which the
-- server treats as "haven't reported yet — don't flag".
ALTER TABLE "Device" ADD COLUMN "agentFeatureVersion" INTEGER;
