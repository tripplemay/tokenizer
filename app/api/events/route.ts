import { NextRequest } from "next/server";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const take = Math.min(Number(request.nextUrl.searchParams.get("take") ?? "100"), 500);
  const events = await prisma.usageEvent.findMany({
    take: Number.isFinite(take) ? take : 100,
    orderBy: { occurredAt: "desc" },
    include: { project: true }
  });
  return Response.json({ events });
}
