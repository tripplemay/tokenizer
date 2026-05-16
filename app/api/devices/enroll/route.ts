import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { DeviceInput } from "@/shared/usage";
import { generateToken, hashToken, tokenPrefix } from "@/server/tokens";

export const dynamic = "force-dynamic";

type EnrollRequest = {
  enrollToken?: string;
  device?: DeviceInput;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as EnrollRequest | null;
  if (!body?.enrollToken || !body.device?.id || !body.device.name) {
    return Response.json({ error: "enrollToken and device are required" }, { status: 400 });
  }

  const now = new Date();
  const token = await prisma.enrollmentToken.findUnique({ where: { tokenHash: hashToken(body.enrollToken) } });
  if (!token || token.usedAt || token.expiresAt <= now) {
    return Response.json({ error: "invalid or expired enrollment token" }, { status: 401 });
  }

  const device = await prisma.device.upsert({
    where: { id: body.device.id },
    update: {
      name: body.device.name,
      hostname: body.device.hostname ?? null,
      platform: body.device.platform ?? null,
      metadata: body.device.metadata === undefined ? Prisma.JsonNull : (body.device.metadata as Prisma.InputJsonValue),
      lastSeenAt: now
    },
    create: {
      id: body.device.id,
      name: body.device.name,
      hostname: body.device.hostname ?? null,
      platform: body.device.platform ?? null,
      metadata: body.device.metadata === undefined ? Prisma.JsonNull : (body.device.metadata as Prisma.InputJsonValue),
      lastSeenAt: now
    }
  });

  const deviceToken = generateToken("dtok");
  await prisma.$transaction([
    prisma.deviceToken.create({
      data: {
        deviceId: device.id,
        tokenHash: hashToken(deviceToken),
        prefix: tokenPrefix(deviceToken),
        lastUsedAt: now,
        metadata: Prisma.JsonNull
      }
    }),
    prisma.enrollmentToken.update({ where: { id: token.id }, data: { usedAt: now, usedById: device.id } })
  ]);

  return Response.json({ device: { id: device.id, name: device.name }, deviceToken });
}
