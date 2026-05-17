-- Multi-tenant foundation: create Auth.js identity tables and add a userId
-- foreign key to every business table. Existing data is backfilled to a
-- seeded "owner" user so the migration is non-destructive — the agent
-- clients, dashboards, and existing rows continue to work without code
-- changes in this same commit.
--
-- Subsequent commits (1b through 1e) layer the Auth.js handlers, login
-- pages, request-scoped tenant resolution, and per-route authz on top.

-- ---- 1. Auth.js identity tables -----------------------------------------
CREATE TABLE "User" (
  "id"            TEXT PRIMARY KEY,
  "email"         TEXT NOT NULL UNIQUE,
  "emailVerified" TIMESTAMP(3),
  "name"          TEXT,
  "image"         TEXT,
  "role"          TEXT NOT NULL DEFAULT 'user',
  "quotaTier"     TEXT NOT NULL DEFAULT 'free',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Account" (
  "id"                TEXT PRIMARY KEY,
  "userId"            TEXT NOT NULL,
  "type"              TEXT NOT NULL,
  "provider"          TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "refresh_token"     TEXT,
  "access_token"      TEXT,
  "expires_at"        INTEGER,
  "token_type"        TEXT,
  "scope"             TEXT,
  "id_token"          TEXT,
  "session_state"     TEXT,
  CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "Account_provider_providerAccountId_key" UNIQUE ("provider", "providerAccountId")
);
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

CREATE TABLE "Session" (
  "id"           TEXT PRIMARY KEY,
  "sessionToken" TEXT NOT NULL UNIQUE,
  "userId"       TEXT NOT NULL,
  "expires"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

CREATE TABLE "VerificationToken" (
  "identifier" TEXT NOT NULL,
  "token"      TEXT NOT NULL UNIQUE,
  "expires"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VerificationToken_identifier_token_key" UNIQUE ("identifier", "token")
);

-- ---- 2. Seed default user (the implicit owner of all pre-migration data)
INSERT INTO "User" ("id", "email", "role", "emailVerified", "createdAt", "updatedAt")
VALUES ('user_default_seed', 'owner@tokenizer.local', 'admin', NOW(), NOW(), NOW());

-- ---- 3. Backfill userId on each business table --------------------------
-- Pattern per table: add nullable column → seed → tighten to NOT NULL with
-- FK → add an index. PostgreSQL applies this in a single migration without
-- breaking concurrent reads.

ALTER TABLE "Project" ADD COLUMN "userId" TEXT;
UPDATE "Project" SET "userId" = 'user_default_seed';
ALTER TABLE "Project" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
CREATE INDEX "Project_userId_idx" ON "Project"("userId");
ALTER TABLE "Project" DROP CONSTRAINT IF EXISTS "Project_workspacePath_key";
ALTER TABLE "Project" DROP CONSTRAINT IF EXISTS "Project_repoKey_key";
CREATE UNIQUE INDEX "Project_userId_workspacePath_key" ON "Project"("userId", "workspacePath");
CREATE UNIQUE INDEX "Project_userId_repoKey_key" ON "Project"("userId", "repoKey");

ALTER TABLE "Device" ADD COLUMN "userId" TEXT;
UPDATE "Device" SET "userId" = 'user_default_seed';
ALTER TABLE "Device" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

ALTER TABLE "UsageEvent" ADD COLUMN "userId" TEXT;
UPDATE "UsageEvent" SET "userId" = 'user_default_seed';
ALTER TABLE "UsageEvent" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
CREATE INDEX "UsageEvent_userId_idx" ON "UsageEvent"("userId");
CREATE INDEX "UsageEvent_userId_occurredAt_idx" ON "UsageEvent"("userId", "occurredAt");

ALTER TABLE "DeviceToken" ADD COLUMN "userId" TEXT;
UPDATE "DeviceToken" SET "userId" = 'user_default_seed';
ALTER TABLE "DeviceToken" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken"("userId");

ALTER TABLE "EnrollmentToken" ADD COLUMN "userId" TEXT;
UPDATE "EnrollmentToken" SET "userId" = 'user_default_seed';
ALTER TABLE "EnrollmentToken" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "EnrollmentToken" ADD CONSTRAINT "EnrollmentToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
CREATE INDEX "EnrollmentToken_userId_idx" ON "EnrollmentToken"("userId");

ALTER TABLE "CollectorState" ADD COLUMN "userId" TEXT;
UPDATE "CollectorState" SET "userId" = 'user_default_seed';
ALTER TABLE "CollectorState" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "CollectorState" ADD CONSTRAINT "CollectorState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
CREATE INDEX "CollectorState_userId_idx" ON "CollectorState"("userId");
ALTER TABLE "CollectorState" DROP CONSTRAINT IF EXISTS "CollectorState_source_key_key";
CREATE UNIQUE INDEX "CollectorState_userId_source_key_key" ON "CollectorState"("userId", "source", "key");
