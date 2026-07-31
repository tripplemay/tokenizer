-- Immutable Agent release version reported by the running client process.
-- Nullable so existing devices and legacy clients remain valid until they
-- complete a heartbeat from a release-aware Agent.
ALTER TABLE "Device" ADD COLUMN "agentReleaseVersion" TEXT;
