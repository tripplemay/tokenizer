import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { authorizeAdminRequest } from "@/server/admin-auth";
import { unauthorized } from "@/server/auth";
import { planModelPriceDetection } from "@/server/pricing/detect";
import { MODEL_PRICE_STATUS } from "@/shared/model-price";
import { maybeTriggerPriceLookup } from "@/server/pricing/trigger";

export const dynamic = "force-dynamic";

// Manual net for the event-driven detector: scan ALL distinct models ever seen
// (global) and enqueue any that are neither seed-priced nor already tracked.
// Mirrors cleanup-claude-legacy: dryRun defaults true and returns a preview;
// dryRun:false applies. On apply, an out-of-band lookup is kicked off for the
// newly-detected keys (no-op unless auto-pricing is enabled).
export async function POST(request: NextRequest) {
  const authz = await authorizeAdminRequest(request);
  if (!authz.ok) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean };
  const dryRun = body.dryRun !== false;

  const [distinct, existing] = await Promise.all([
    prisma.usageEvent.groupBy({ by: ["model"], _sum: { totalTokens: true } }),
    prisma.modelPrice.findMany({ select: { modelKey: true } })
  ]);
  const existingKeys = new Set(existing.map((row) => row.modelKey));
  const plan = planModelPriceDetection(
    distinct.map((row) => row.model),
    existingKeys
  );

  const detectedKeys = plan.filter((row) => row.status === MODEL_PRICE_STATUS.detected).map((row) => row.modelKey);
  const summary = {
    distinctModels: distinct.length,
    alreadyTracked: existingKeys.size,
    toDetect: detectedKeys.length,
    toAutoFree: plan.filter((row) => row.status === MODEL_PRICE_STATUS.autoApplied).length,
    newKeys: plan.map((row) => row.modelKey)
  };

  if (dryRun) {
    return Response.json({ dryRun: true, executed: false, summary });
  }

  if (plan.length > 0) {
    await prisma.modelPrice.createMany({ data: plan, skipDuplicates: true });
  }
  if (detectedKeys.length > 0) {
    await maybeTriggerPriceLookup(detectedKeys);
  }
  return Response.json({ dryRun: false, executed: true, summary });
}
