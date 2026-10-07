import { NextRequest } from "next/server";
import { authenticateDeviceToken, forbidden, unauthorized } from "@/server/auth";
import { ingestUsageEvents } from "@/server/ingest";
import { invalidateUsageCostCache } from "@/server/usage-cost-cache";
import { maybeTriggerPriceLookup } from "@/server/pricing/trigger";
import { updateUserTimezoneIfValid } from "@/server/timezone";
import { invalidBatchResponse, readBoundedBatchJson, validateUsageBatch } from "@/server/batch-input";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const token = await authenticateDeviceToken(request);
  if (!token) return unauthorized();

  if (!token.device || token.device.id !== token.deviceId || token.device.userId !== token.userId) return forbidden();
  let body: ReturnType<typeof validateUsageBatch>;
  try {
    body = validateUsageBatch(await readBoundedBatchJson(request));
  } catch (error) {
    return invalidBatchResponse(error);
  }
  if (body.device.id !== token.deviceId) return forbidden("device token does not match device");

  await updateUserTimezoneIfValid(token.userId, body.timezone);

  const result = await ingestUsageEvents(body.events, body.device, token.id, token.userId);
  if (result.inserted > 0 || (result.updated ?? 0) > 0) {
    invalidateUsageCostCache(token.userId);
  }

  // Event-driven auto-pricing: kick off an out-of-band lookup for any brand-new
  // unpriced models this batch introduced. after() runs post-response so the
  // external HTTP never delays the client's upload; no-op unless auto-pricing
  // is enabled.
  if (result.newModelKeys && result.newModelKeys.length > 0) {
    await maybeTriggerPriceLookup(result.newModelKeys);
  }

  return Response.json(result);
}
