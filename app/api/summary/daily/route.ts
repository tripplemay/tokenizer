import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { getDailySummary, type RangeOption } from "@/server/summaries";

export const dynamic = "force-dynamic";

function parseRange(raw: string | null): RangeOption {
  if (raw === "7d" || raw === "30d") return raw;
  return "all";
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
  const range = parseRange(request.nextUrl.searchParams.get("range"));
  return Response.json({ daily: await getDailySummary(session.user.id, range) });
}
