import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { DEFAULT_TENANT_ID, isAdminAuthorized, unauthorized } from "@/server/auth";
import { prisma } from "@/server/db";
import { generateToken, hashToken, tokenPrefix } from "@/server/tokens";

export const dynamic = "force-dynamic";

const DEFAULT_EXPIRES_MINUTES = 30;
const MAX_EXPIRES_MINUTES = 24 * 60;

export async function POST(request: NextRequest) {
  if (!isAdminAuthorized(request)) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as { label?: string; expiresInMinutes?: number };
  const expiresInMinutes = Math.max(1, Math.min(MAX_EXPIRES_MINUTES, Math.trunc(body.expiresInMinutes || DEFAULT_EXPIRES_MINUTES)));
  const enrollToken = generateToken("enroll");
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

  // Admin-issued enroll tokens belong to the seeded owner until the per-user
  // session-aware flow ships in 1b/1c. Then this becomes session.user.id.
  await prisma.enrollmentToken.create({
    data: {
      userId: DEFAULT_TENANT_ID,
      label: body.label?.trim() || null,
      tokenHash: hashToken(enrollToken),
      prefix: tokenPrefix(enrollToken),
      expiresAt,
      metadata: Prisma.JsonNull
    }
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") || request.nextUrl.origin;
  const installCommand = `curl -fsSL ${appUrl}/install.sh | bash -s -- --enroll-token ${enrollToken}`;

  return Response.json({ enrollToken, expiresAt: expiresAt.toISOString(), installCommand });
}
