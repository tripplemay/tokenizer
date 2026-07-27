import { NextRequest } from "next/server";
import { authenticateDeviceToken, unauthorized } from "@/server/auth";
import { prisma } from "@/server/db";
import {
  HARNESS_API_MAX_BYTES,
  HARNESS_MODE_INTENT_ACTIVE_STATUSES,
  HARNESS_MODE_INTENT_RELAY_STATUSES,
  harnessInputErrorResponse,
  isIdenticalRelayAck,
  parseRelayModeIntentAck,
  readBoundedJson,
  relayAckSourceStatuses
} from "@/server/harness-mode-intent-api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = await authenticateDeviceToken(request);
  if (!token) return unauthorized();
  const now = new Date();
  const projectScope = { deviceId: token.deviceId, userId: token.userId };

  await prisma.harnessModeIntent.updateMany({
    where: {
      userId: token.userId,
      harnessProject: projectScope,
      status: { in: [...HARNESS_MODE_INTENT_ACTIVE_STATUSES] },
      intentExpiresAt: { lte: now }
    },
    data: { status: "expired" }
  });

  const rows = await prisma.harnessModeIntent.findMany({
    where: {
      userId: token.userId,
      harnessProject: projectScope,
      status: { in: [...HARNESS_MODE_INTENT_RELAY_STATUSES] },
      intentExpiresAt: { gt: now },
      signature: { not: "" }
    },
    include: { harnessProject: { select: { id: true, repoKey: true } } },
    orderBy: { issuedAt: "asc" },
    take: 50
  });

  const issuedIds = rows.filter((row) => row.status === "issued").map((row) => row.id);
  if (issuedIds.length > 0) {
    await prisma.harnessModeIntent.updateMany({
      where: {
        id: { in: issuedIds },
        userId: token.userId,
        harnessProject: projectScope,
        status: "issued"
      },
      data: { status: "relayed", relayedAt: now }
    });
  }

  return Response.json({
    intents: rows.map((row) => ({
      projectId: row.harnessProject.id,
      repoKey: row.harnessProject.repoKey,
      intent: { ...(row.payload as Record<string, unknown>), sig: row.signature }
    }))
  });
}

export async function POST(request: NextRequest) {
  const token = await authenticateDeviceToken(request);
  if (!token) return unauthorized();

  let ack;
  try {
    ack = parseRelayModeIntentAck(await readBoundedJson(request, HARNESS_API_MAX_BYTES));
  } catch (error) {
    return harnessInputErrorResponse(error);
  }

  const intent = await prisma.harnessModeIntent.findFirst({
    where: {
      intentId: ack.intentId,
      harnessProjectId: ack.projectId,
      userId: token.userId,
      harnessProject: { deviceId: token.deviceId, userId: token.userId }
    },
    select: {
      id: true,
      harnessProjectId: true,
      status: true,
      stagedAt: true,
      stagedCommitSha: true,
      appliedAt: true,
      appliedBatch: true,
      failedAt: true,
      failureCode: true,
      failureDetail: true
    }
  });
  if (!intent) return Response.json({ error: "mode intent not found" }, { status: 404 });

  if (isIdenticalRelayAck(intent, ack)) {
    return Response.json({ ok: true, intentId: ack.intentId, status: ack.status, idempotent: true });
  }

  const allowedSources = relayAckSourceStatuses(ack.status);
  if (!allowedSources.includes(intent.status)) {
    return Response.json(
      { error: "mode intent ACK is not valid from the current state", code: "invalid_transition" },
      { status: 409 }
    );
  }

  const data =
    ack.status === "staged"
      ? { status: "staged", stagedAt: ack.stagedAt, stagedCommitSha: ack.stagedCommitSha }
      : ack.status === "applied"
        ? { status: "applied", appliedAt: ack.appliedAt, appliedBatch: ack.appliedBatch }
        : {
            status: "failed",
            failedAt: ack.failedAt,
            failureCode: ack.failureCode,
            failureDetail: ack.failureDetail
          };

  const updated = await prisma.harnessModeIntent.updateMany({
    where: {
      id: intent.id,
      harnessProjectId: intent.harnessProjectId,
      userId: token.userId,
      status: { in: [...allowedSources] }
    },
    data
  });
  if (updated.count !== 1) {
    return Response.json({ error: "mode intent state changed; retry", code: "state_conflict" }, { status: 409 });
  }

  return Response.json({ ok: true, intentId: ack.intentId, status: ack.status, idempotent: false });
}
