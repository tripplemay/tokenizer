import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { authenticateDeviceToken, forbidden, unauthorized } from "@/server/auth";
import { prisma } from "@/server/db";
import { DeviceInput } from "@/shared/usage";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const token = await authenticateDeviceToken(request);
  if (!token) return unauthorized();

  const body = (await request.json().catch(() => null)) as { device?: DeviceInput } | null;
  if (!body?.device?.id || !body.device.name) return Response.json({ error: "device is required" }, { status: 400 });
  if (body.device.id !== token.deviceId) return forbidden("device token does not match device");

  const now = new Date();
  await prisma.$transaction([
    prisma.device.update({
      where: { id: body.device.id },
      data: {
        name: body.device.name,
        hostname: body.device.hostname ?? null,
        platform: body.device.platform ?? null,
        metadata: body.device.metadata === undefined ? Prisma.JsonNull : (body.device.metadata as Prisma.InputJsonValue),
        lastSeenAt: now
      }
    }),
    prisma.deviceToken.update({ where: { id: token.id }, data: { lastUsedAt: now } })
  ]);

  return Response.json({ ok: true, deviceId: body.device.id, lastSeenAt: now.toISOString() });
}
