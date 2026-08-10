import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { DeviceInput } from "@/shared/usage";
import { generateToken, hashToken, tokenPrefix } from "@/server/tokens";
import { retrySerializableTransaction } from "@/server/serializable-transaction";
import { isValidDeviceName } from "@/shared/input-sanitization";

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
  if (!isValidDeviceName(body.device.name)) {
    return Response.json({ error: "invalid device name", code: "invalid_device_name" }, { status: 400 });
  }

  const now = new Date();
  const result = await retrySerializableTransaction(() =>
    prisma.$transaction(
      async (tx) => {
        const enrollment = await tx.enrollmentToken.findUnique({
          where: { tokenHash: hashToken(body.enrollToken) }
        });
        if (!enrollment || enrollment.usedAt || enrollment.expiresAt <= now) return { kind: "invalid" as const };

        // A globally stable device ID must not be taken over by a different
        // tenant merely by presenting a valid enrollment token.
        const existingDevice = await tx.device.findUnique({
          where: { id: body.device.id },
          select: { userId: true }
        });
        if (existingDevice && existingDevice.userId !== enrollment.userId) return { kind: "ownership-conflict" as const };

        // This conditional write is the one-time claim. It makes concurrent
        // enrollment attempts deterministic even before Serializable retry
        // has a chance to re-run a transaction that lost a conflict.
        const claimed = await tx.enrollmentToken.updateMany({
          where: { id: enrollment.id, usedAt: null, expiresAt: { gt: now } },
          data: { usedAt: now, usedById: body.device.id }
        });
        if (claimed.count !== 1) return { kind: "invalid" as const };

        const device = await tx.device.upsert({
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
            userId: enrollment.userId,
            name: body.device.name,
            hostname: body.device.hostname ?? null,
            platform: body.device.platform ?? null,
            metadata: body.device.metadata === undefined ? Prisma.JsonNull : (body.device.metadata as Prisma.InputJsonValue),
            lastSeenAt: now
          }
        });

        // Re-enrollment deliberately rotates credentials. Revoke every
        // active token for this device before adding the newly issued one.
        await tx.deviceToken.updateMany({
          where: { deviceId: device.id, revokedAt: null },
          data: { revokedAt: now }
        });

        const deviceToken = generateToken("dtok");
        await tx.deviceToken.create({
          data: {
            userId: enrollment.userId,
            deviceId: device.id,
            tokenHash: hashToken(deviceToken),
            prefix: tokenPrefix(deviceToken),
            lastUsedAt: now,
            metadata: Prisma.JsonNull
          }
        });

        return { kind: "ok" as const, device, deviceToken };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );

  if (result.kind === "invalid") {
    return Response.json({ error: "invalid or expired enrollment token" }, { status: 401 });
  }
  if (result.kind === "ownership-conflict") {
    return Response.json({ error: "device is already registered to another user" }, { status: 403 });
  }

  return Response.json({ device: { id: result.device.id, name: result.device.name }, deviceToken: result.deviceToken });
}
