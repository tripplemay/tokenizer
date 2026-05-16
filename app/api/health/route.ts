import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

// Lightweight liveness/readiness endpoint. Returns 200 with a JSON body that
// includes the deployed commit so post-deploy automation and reverse proxies
// have a cheap way to confirm the new container actually came up. Returns 503
// when the database is unreachable so a misconfigured deploy fails loudly
// instead of returning stale dashboard data.
export async function GET() {
  const startedAt = new Date().toISOString();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({
      ok: true,
      timestamp: startedAt,
      commit: process.env.GIT_COMMIT ?? "unknown"
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        timestamp: startedAt,
        commit: process.env.GIT_COMMIT ?? "unknown",
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 503 }
    );
  }
}
