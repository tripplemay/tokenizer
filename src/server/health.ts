import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/server/db";
import { deployedCommit, healthCapabilities } from "@/server/health-core";

type HealthCode = "ready" | "config_not_ready" | "database_unavailable" | "schema_not_ready";

export function latestMigrationName(migrationsPath = join(process.cwd(), "prisma", "migrations")): string | null {
  try {
    return readdirSync(migrationsPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .at(-1) ?? null;
  } catch {
    return null;
  }
}

function failure(code: Exclude<HealthCode, "ready">, stage: string, error?: unknown): Response {
  const requestId = randomUUID();
  const rawErrorCode = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const errorCode = /^[A-Z0-9]{1,16}$/.test(rawErrorCode) ? rawErrorCode : undefined;
  console.error("readiness failed", { requestId, stage, code, errorCode });
  return Response.json({ ok: false, code, commit: deployedCommit(), requestId }, { status: 503 });
}

export async function readinessResponse(): Promise<Response> {
  const capabilities = healthCapabilities();
  if (
    process.env.NODE_ENV === "production" &&
    (!capabilities.authSession || !capabilities.admin || !capabilities.email)
  ) {
    return failure("config_not_ready", "runtime_config");
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    return failure("database_unavailable", "database", error);
  }

  const migration = latestMigrationName();
  if (!migration) return failure("schema_not_ready", "migration_manifest");
  try {
    const applied = await prisma.$queryRaw<Array<{ present: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name = ${migration}
          AND finished_at IS NOT NULL
          AND rolled_back_at IS NULL
      ) AS present
    `;
    if (!applied[0]?.present) return failure("schema_not_ready", "migration_pending");
  } catch (error) {
    return failure("schema_not_ready", "migration_query", error);
  }
  return Response.json({ ok: true, code: "ready", commit: deployedCommit() });
}
