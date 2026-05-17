import { NextRequest } from "next/server";
import { getDailySummary, type RangeOption } from "@/server/summaries";
import { getCurrentTenantId } from "@/server/auth-session";

export const dynamic = "force-dynamic";

function parseRange(raw: string | null): RangeOption {
  if (raw === "7d" || raw === "30d") return raw;
  return "all";
}

export async function GET(request: NextRequest) {
  // TODO(1d): require a session.
  const tenantId = await getCurrentTenantId();
  const range = parseRange(request.nextUrl.searchParams.get("range"));
  return Response.json({ daily: await getDailySummary(tenantId, range) });
}
