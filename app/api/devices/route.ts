import { getDeviceSummary } from "@/server/summaries";
import { getCurrentTenantId } from "@/server/auth-session";

export const dynamic = "force-dynamic";

export async function GET() {
  // TODO(1d): require a session.
  const tenantId = await getCurrentTenantId();
  return Response.json({ devices: await getDeviceSummary(tenantId) });
}
