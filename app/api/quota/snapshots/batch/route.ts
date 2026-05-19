import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { authenticateDeviceToken, forbidden, unauthorized } from "@/server/auth";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

type SnapshotBody = {
  device?: { id: string; name?: string };
  snapshots: Array<{
    provider: string;
    accountKey: string;
    windowKey: string;
    utilization?: number;
    usedRaw?: number;
    limitRaw?: number;
    unit?: string;
    resetsAt?: string;
    rawJson?: unknown;
  }>;
};

export async function POST(request: NextRequest) {
  const token = await authenticateDeviceToken(request);
  if (!token) return unauthorized();

  const body = (await request.json().catch(() => null)) as SnapshotBody | null;
  if (!body) {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body?.snapshots)) {
    return Response.json({ error: "snapshots required" }, { status: 400 });
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
    usedRaw: s.usedRaw != null ? BigInt(Math.round(s.usedRaw)) : null,
    limitRaw: s.limitRaw != null ? BigInt(Math.round(s.limitRaw)) : null,
    unit: s.unit ?? null,
    resetsAt: s.resetsAt ? new Date(s.resetsAt) : null,
    capturedBy: token.deviceId,
    rawJson: s.rawJson === undefined ? Prisma.JsonNull : (s.rawJson as Prisma.InputJsonValue),
  }));

  const result = await prisma.quotaSnapshot.createMany({ data: rows });
  return Response.json({ received: body.snapshots.length, inserted: result.count });
}
