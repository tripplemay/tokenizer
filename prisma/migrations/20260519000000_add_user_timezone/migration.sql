-- Add a nullable timezone column to User. IANA name (e.g. "Asia/Shanghai").
-- Populated lazily by CLI sync/heartbeat or browser dashboard mount.
-- Application falls back to "Asia/Shanghai" when null, preserving prior
-- behavior for users who haven't reported yet.

ALTER TABLE "User" ADD COLUMN "timezone" TEXT;
