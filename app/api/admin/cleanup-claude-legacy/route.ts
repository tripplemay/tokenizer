import { NextRequest } from "next/server";
import { isAdminAuthorized, unauthorized } from "@/server/auth";
import { prisma } from "@/server/db";
import { selectClaudeLegacyCleanup } from "@/server/cleanup";
import { invalidateUsageCostCache } from "@/server/usage-cost-cache";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isAdminAuthorized(request)) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean };
  const dryRun = body.dryRun !== false;

  const oldRows = await prisma.usageEvent.findMany({
    where: { source: "claude-code", sourceEventId: { startsWith: "claude:" } },
    select: { id: true, userId: true, deviceId: true, sessionId: true, totalTokens: true, sourceEventId: true }
  });

  const existingStableRows = await prisma.usageEvent.findMany({
    where: { source: "claude-code", sourceEventId: { startsWith: "claude-legacy:" } },
    select: { deviceId: true, sessionId: true }
  });
  const existingStableKeys = new Set(
    existingStableRows
      .filter((row) => row.sessionId !== null)
      .map((row) => `${row.deviceId}:${row.sessionId}`)
  );

  const plan = selectClaudeLegacyCleanup(oldRows, existingStableKeys);

  const summary = {
    rowsConsidered: plan.rowsConsidered,
    groupsCount: plan.groupsCount,
    rowsSkippedNoSession: plan.rowsSkippedNoSession,
    rowsToUpdate: plan.toUpdate.length,
    rowsToDelete: plan.toDelete.length,
    tokensBefore: plan.tokensBefore,
    tokensAfterCleanup: plan.tokensAfterCleanup,
    tokensReclaimed: plan.tokensBefore - plan.tokensAfterCleanup
  };

  if (dryRun) {
    return Response.json({ dryRun: true, executed: false, summary });
  }

  await prisma.$transaction([
    ...plan.toUpdate.map((entry) =>
      prisma.usageEvent.update({
        where: { id: entry.id },
        data: { sourceEventId: entry.newSourceEventId }
      })
    ),
    prisma.usageEvent.deleteMany({ where: { id: { in: plan.toDelete } } })
  ]);

  const changedIds = new Set([...plan.toUpdate.map((row) => row.id), ...plan.toDelete]);
  for (const userId of new Set(oldRows.filter((row) => changedIds.has(row.id)).map((row) => row.userId))) {
    invalidateUsageCostCache(userId);
  }

  return Response.json({ dryRun: false, executed: true, summary });
}
