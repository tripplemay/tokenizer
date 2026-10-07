import { NextRequest } from "next/server";
import { authenticateDeviceToken, forbidden, unauthorized } from "@/server/auth";
import { ingestUsageEvents } from "@/server/ingest";
import { invalidateUsageCostCache } from "@/server/usage-cost-cache";
import { maybeTriggerPriceLookup } from "@/server/pricing/trigger";
import { updateUserTimezoneIfValid } from "@/server/timezone";
import { invalidBatchResponse, readBoundedBatchJson, validateUsageBatch, validateUsageBatchPartial } from "@/server/batch-input";
import { USAGE_PARTIAL_ACK_PROTOCOL } from "@/shared/usage-batch-protocol";

export const dynamic = "force-dynamic";
export { USAGE_PARTIAL_ACK_PROTOCOL };

export async function POST(request: NextRequest) {
  const token = await authenticateDeviceToken(request);
  if (!token) return unauthorized();

  if (!token.device || token.device.id !== token.deviceId || token.device.userId !== token.userId) return forbidden();
  const partial = request.headers.get("x-tokenizer-batch-protocol") === USAGE_PARTIAL_ACK_PROTOCOL;
  let body: ReturnType<typeof validateUsageBatch>;
  let acceptedRows: number[] | undefined;
  let rejected: ReturnType<typeof validateUsageBatchPartial>["rejected"] = [];
  try {
    const input = await readBoundedBatchJson(request, { locateInvalidUsageRow: partial });
    if (partial) {
      const result = validateUsageBatchPartial(input);
      body = result.body;
      acceptedRows = result.acceptedRows;
      rejected = result.rejected;
    } else {
      body = validateUsageBatch(input);
    }
  } catch (error) {
    return invalidBatchResponse(error);
  }
  if (body.device.id !== token.deviceId) return forbidden("device token does not match device");

  // A partial request containing only rejected rows must remain write-free.
  // A valid empty batch retains the legacy heartbeat/lastSyncAt behavior.
  const shouldIngest = body.events.length > 0 || rejected.length === 0;
  if (shouldIngest) await updateUserTimezoneIfValid(token.userId, body.timezone);

  const result = shouldIngest
    ? await ingestUsageEvents(body.events, body.device, token.id, token.userId)
    : { inserted: 0, updated: 0, duplicates: 0, received: 0, deviceId: token.deviceId, newModelKeys: [] as string[] };
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

  if (!partial) return Response.json(result);
  // acceptedRows are indices into the original request. The route has already
  // validated their identity fields, so this is an explicit, bounded ID ACK.
  return Response.json({
    ...result,
    protocol: USAGE_PARTIAL_ACK_PROTOCOL,
    accepted: acceptedRows!.map((row, index) => ({
      row,
      source: body.events[index].source,
      sourceEventId: body.events[index].sourceEventId
    })),
    rejected
  });
}
