import { NextRequest } from "next/server";
import { getDailySummary } from "@/server/summaries";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const days = Number(request.nextUrl.searchParams.get("days") ?? "180");
  return Response.json({ daily: await getDailySummary(Number.isFinite(days) ? days : 180) });
}
