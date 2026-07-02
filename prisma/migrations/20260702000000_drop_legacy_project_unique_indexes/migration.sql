-- 20260518000000_multi_tenant_foundation added the tenant-scoped uniques
-- (userId, workspacePath) / (userId, repoKey) but never dropped the original
-- single-column uniques from the init migration. Those legacy indexes reject
-- the same workspacePath or repoKey across *different* users, and break the
-- non-git -> git project transition (create with an already-seen path).
DROP INDEX IF EXISTS "Project_workspacePath_key";
DROP INDEX IF EXISTS "Project_repoKey_key";

-- Same class of leftover: the multi-tenant migration ran
-- DROP CONSTRAINT IF EXISTS "CollectorState_source_key_key", but that name is
-- a unique *index* (from init), not a table constraint, so the drop silently
-- did nothing and the global (source, key) unique survived.
DROP INDEX IF EXISTS "CollectorState_source_key_key";
