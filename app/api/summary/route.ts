import { getBreakdown, getDailySummary, getProjectSummary, getSummary } from "@/server/summaries";

export const dynamic = "force-dynamic";

export async function GET() {
  const [summary, projects, daily, sources, models] = await Promise.all([
    getSummary(),
    getProjectSummary(),
    getDailySummary(),
    getBreakdown("source"),
    getBreakdown("model")
  ]);
  return Response.json({ summary, projects, daily, sources, models });
}
