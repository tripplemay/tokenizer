import { auth } from "@/auth";
import { getBreakdown, getDailySummary, getDeviceSummary, getProjectSummary, getSummary } from "@/server/summaries";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
  const tenantId = session.user.id;
  const [summary, projects, daily, sources, models, devices] = await Promise.all([
    getSummary(tenantId),
    getProjectSummary(tenantId),
    getDailySummary(tenantId),
    getBreakdown(tenantId, "source"),
    getBreakdown(tenantId, "model"),
    getDeviceSummary(tenantId)
  ]);
  return Response.json({ summary, projects, daily, sources, models, devices });
}
