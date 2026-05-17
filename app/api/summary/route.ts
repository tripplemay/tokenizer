import { getBreakdown, getDailySummary, getDeviceSummary, getProjectSummary, getSummary } from "@/server/summaries";
import { getCurrentTenantId } from "@/server/auth-session";

export const dynamic = "force-dynamic";

export async function GET() {
  // TODO(1d): require a real session here; for now we default to the seeded
  // owner tenant so the existing endpoint keeps returning data during the
  // multi-tenant rollout.
  const tenantId = await getCurrentTenantId();
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
