import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/server/db";
import { generateToken, hashToken, tokenPrefix } from "@/server/tokens";

export const dynamic = "force-dynamic";

const DEFAULT_EXPIRES_MINUTES = 30;
const MAX_EXPIRES_MINUTES = 24 * 60;

// Generates a one-time device-enrollment token bound to the calling user.
// Replaces the previous ADMIN_TOKEN-gated flow — each user manages enroll
// tokens for their own tenant via /settings/enrollment (and during the
// transition, /admin/setup which still hits this route).
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { label?: string; expiresInMinutes?: number };
  const expiresInMinutes = Math.max(1, Math.min(MAX_EXPIRES_MINUTES, Math.trunc(body.expiresInMinutes || DEFAULT_EXPIRES_MINUTES)));
  const enrollToken = generateToken("enroll");
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

  const enrollment = await prisma.enrollmentToken.create({
    data: {
      userId: session.user.id,
      label: body.label?.trim() || null,
      tokenHash: hashToken(enrollToken),
      prefix: tokenPrefix(enrollToken),
      expiresAt,
      metadata: Prisma.JsonNull
    }
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") || request.nextUrl.origin;
  const installCommand = `curl -fsSL ${appUrl}/install.sh | bash -s -- --enroll-token ${enrollToken}`;
  const windowsInstallCommand =
    `& ([scriptblock]::Create((irm ${appUrl}/install.ps1))) -EnrollToken ${enrollToken}`;
  const installCommands = [
    { id: "posix", label: "macOS / Linux", command: installCommand },
    { id: "windows", label: "Windows", command: windowsInstallCommand }
  ];

  // installCommand is retained alongside installCommands so an older client
  // that only knows the single-string shape keeps working.
  return Response.json({
    enrollToken,
    expiresAt: expiresAt.toISOString(),
    installCommand,
    installCommands,
    enrollmentId: enrollment.id
  });
}
