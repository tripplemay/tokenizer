import { auth } from "@/auth";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const enrollment = await prisma.enrollmentToken.findFirst({
    where: { id, userId: session.user.id },
    select: { usedAt: true, usedById: true, expiresAt: true }
  });
  if (!enrollment) return Response.json({ error: "not found" }, { status: 404 });

  const device = enrollment.usedById
    ? await prisma.device.findFirst({
        where: { id: enrollment.usedById, userId: session.user.id },
        select: { name: true }
      })
    : null;

  return Response.json(
    {
      usedAt: enrollment.usedAt?.toISOString() ?? null,
      usedById: enrollment.usedById,
      deviceName: device?.name ?? null,
      expiresAt: enrollment.expiresAt.toISOString()
    },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } }
  );
}
