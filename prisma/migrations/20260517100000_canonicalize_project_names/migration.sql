-- Backfill: for every Project that has a repoKey, force the display name to
-- the repo-derived last segment so it stops oscillating between local folder
-- names whenever a new device with a differently-named clone syncs. This is
-- a one-time fix to align with the new ensureProject() rule that prefers
-- projectNameFromRepoKey when repoKey is present.

UPDATE "Project"
SET name = regexp_replace("repoKey", '^.*/', '')
WHERE "repoKey" IS NOT NULL AND "repoKey" <> '';
