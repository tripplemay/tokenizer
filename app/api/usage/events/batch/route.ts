import { NextRequest } from "next/server";
import { isAuthorized, unauthorized } from "@/server/auth";
import { ingestUsageEvents } from "@/server/ingest";
import { BatchUsageRequest } from "@/shared/usage";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return unauthorized();

  const body = (await request.json()) as BatchUsageRequest;
  if (!body || !Array.isArray(body.events)) {
    return Response.json({ error: "events must be an array" }, { status: 400 });
  }

  const result = await ingestUsageEvents(body.events, body.device);
  return Response.json(result);
}
