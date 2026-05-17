import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { hashToken, safeEqual } from "./tokens";

export const ADMIN_COOKIE = "admin_token";

// Multi-tenant foundation (Phase 1a): every business row is now owned by a
// User. Before the Auth.js login flow lands in 1b, server actions that don't
// yet have a request-scoped session (admin token, enroll flow) attribute
// writes to this seeded "owner" user — the same one the data migration
// backfilled all existing rows to. Subsequent commits replace this with
// session.user.id once the login surface ships.
export const DEFAULT_TENANT_ID = "user_default_seed";

export function isAdminAuthorized(request: NextRequest): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  const header = request.headers.get("x-admin-token");
  if (header && safeEqual(header, expected)) return true;
  const cookieToken = request.cookies.get(ADMIN_COOKIE)?.value;
  if (cookieToken && safeEqual(cookieToken, expected)) return true;
  return false;
}

export async function isAdminAuthorizedFromCookie(): Promise<boolean> {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  const store = await cookies();
  const provided = store.get(ADMIN_COOKIE)?.value;
  return Boolean(provided && safeEqual(provided, expected));
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
