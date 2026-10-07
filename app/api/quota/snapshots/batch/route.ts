import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { authenticateDeviceToken, forbidden, unauthorized } from "@/server/auth";
import { prisma } from "@/server/db";
import { invalidBatchResponse, readBoundedBatchJson, validateQuotaBatch } from "@/server/batch-input";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const token = await authenticateDeviceToken(request);
  if (!token) return unauthorized();

  if (!token.device || token.device.id !== token.deviceId || token.device.userId !== token.userId) return forbidden();
  let body: ReturnType<typeof validateQuotaBatch>;
  try {
    body = validateQuotaBatch(await readBoundedBatchJson(request));
  } catch (error) {
    return invalidBatchResponse(error);
  }
  if (body.device && body.device.id !== token.deviceId) {
    return forbidden("device token does not match device");
  }
  if (body.snapshots.length === 0) {
    return Response.json({ received: 0, inserted: 0 });
  }

  const rows = body.snapshots.map((s) => ({
    userId: token.userId,
    provider: s.provider,
    accountKey: s.accountKey,
    windowKey: s.windowKey,
    utilization: s.utilization != null ? new Prisma.Decimal(s.utilization) : null,
    usedRaw: s.usedRaw != null ? BigInt(s.usedRaw) : null,
    limitRaw: s.limitRaw != null ? BigInt(s.limitRaw) : null,
    unit: s.unit ?? null,
    resetsAt: s.resetsAt ? new Date(s.resetsAt) : null,
    capturedBy: token.deviceId,
    rawJson: s.rawJson === undefined ? Prisma.JsonNull : (s.rawJson as Prisma.InputJsonValue),
  }));

  const result = await prisma.quotaSnapshot.createMany({ data: rows });
  return Response.json({ received: body.snapshots.length, inserted: result.count });
}
