import { NextRequest } from "next/server";
import { authenticateDeviceToken, forbidden, unauthorized } from "@/server/auth";
import { ingestUsageEvents } from "@/server/ingest";
import { maybeTriggerPriceLookup } from "@/server/pricing/trigger";
import { updateUserTimezoneIfValid } from "@/server/timezone";
import { BatchUsageRequest } from "@/shared/usage";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const token = await authenticateDeviceToken(request);
  if (!token) return unauthorized();

  const body = (await request.json()) as BatchUsageRequest;
  if (!body?.device?.id || !body.device.name || !Array.isArray(body.events)) {
    return Response.json({ error: "device and events are required" }, { status: 400 });
  }
  if (body.device.id !== token.deviceId) return forbidden("device token does not match device");

  await updateUserTimezoneIfValid(token.userId, body.timezone);

  const result = await ingestUsageEvents(body.events, body.device, token.id, token.userId);

  // Event-driven auto-pricing: kick off an out-of-band lookup for any brand-new
  // unpriced models this batch introduced. after() runs post-response so the
  // external HTTP never delays the client's upload; no-op unless auto-pricing
  // is enabled.
  if (result.newModelKeys && result.newModelKeys.length > 0) {
    await maybeTriggerPriceLookup(result.newModelKeys);
  }

  return Response.json(result);
}
