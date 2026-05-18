import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { authenticateDeviceToken, forbidden, unauthorized } from "@/server/auth";
import { prisma } from "@/server/db";
import { updateUserTimezoneIfValid } from "@/server/timezone";
import { DeviceInput } from "@/shared/usage";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const token = await authenticateDeviceToken(request);
  if (!token) return unauthorized();

  const body = (await request.json().catch(() => null)) as { device?: DeviceInput; timezone?: string } | null;
  if (!body?.device?.id || !body.device.name) return Response.json({ error: "device is required" }, { status: 400 });
  if (body.device.id !== token.deviceId) return forbidden("device token does not match device");

  const now = new Date();
  // Diagnostics are optional — old clients won't send them. We only set the
  // diagnostic columns when the payload actually carries values so a missing
  // field doesn't clobber the last-known-good value with null.
  const diag = body.device.diagnostics ?? {};
  const data: Prisma.DeviceUpdateInput = {
    name: body.device.name,
    hostname: body.device.hostname ?? null,
    platform: body.device.platform ?? null,
    metadata: body.device.metadata === undefined ? Prisma.JsonNull : (body.device.metadata as Prisma.InputJsonValue),
    lastSeenAt: now
  };
  if ("agentVersion" in diag) data.agentVersion = diag.agentVersion ?? null;
  if ("queueDepth" in diag) data.queueDepth = typeof diag.queueDepth === "number" ? diag.queueDepth : null;
  if ("lastError" in diag) {
    data.lastError = diag.lastError ?? null;
    data.lastErrorAt = diag.lastError ? now : null;
  }
  if ("lastSyncStatus" in diag) data.lastSyncStatus = diag.lastSyncStatus ?? null;

  await prisma.$transaction([
    prisma.device.update({ where: { id: body.device.id }, data }),
    prisma.deviceToken.update({ where: { id: token.id }, data: { lastUsedAt: now } })
  ]);

  await updateUserTimezoneIfValid(token.userId, body.timezone);

  return Response.json({ ok: true, deviceId: body.device.id, lastSeenAt: now.toISOString() });
}
