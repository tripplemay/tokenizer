import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const projects = await prisma.project.findMany({ orderBy: { updatedAt: "desc" } });
  return Response.json({ projects });
}
