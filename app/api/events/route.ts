import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
  const take = Math.min(Number(request.nextUrl.searchParams.get("take") ?? "100"), 500);
  const events = await prisma.usageEvent.findMany({
    where: { userId: session.user.id },
    take: Number.isFinite(take) ? take : 100,
    orderBy: { occurredAt: "desc" },
    include: { project: true }
  });
  return Response.json({ events });
}
