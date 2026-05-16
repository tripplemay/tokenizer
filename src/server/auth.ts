import { NextRequest } from "next/server";
import { prisma } from "./db";
import { hashToken, safeEqual } from "./tokens";

export function isAdminAuthorized(request: NextRequest): boolean {
  const expected = process.env.ADMIN_TOKEN;
  const provided = request.headers.get("x-admin-token");
  return Boolean(expected && provided && safeEqual(provided, expected));
}

export function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function authenticateDeviceToken(request: NextRequest) {
  const token = bearerToken(request);
  if (!token) return null;
  const deviceToken = await prisma.deviceToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { device: true }
  });
  if (!deviceToken || deviceToken.revokedAt) return null;
  return deviceToken;
}

export function unauthorized() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

export function forbidden(message = "forbidden") {
  return Response.json({ error: message }, { status: 403 });
}
