import { getBreakdown, getDailySummary, getDeviceSummary, getProjectSummary, getSummary } from "@/server/summaries";

export const dynamic = "force-dynamic";

export async function GET() {
  const [summary, projects, daily, sources, models, devices] = await Promise.all([
    getSummary(),
    getProjectSummary(),
    getDailySummary(),
    getBreakdown("source"),
    getBreakdown("model"),
    getDeviceSummary()
  ]);
  return Response.json({ summary, projects, daily, sources, models, devices });
}
