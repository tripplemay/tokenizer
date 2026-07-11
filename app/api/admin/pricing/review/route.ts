import { NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/server/db";
import { authorizeAdminRequest } from "@/server/admin-auth";
import { unauthorized } from "@/server/auth";
import { MODEL_PRICES_CACHE_TAG, MODEL_PRICE_STATUS } from "@/shared/model-price";
import { resolveReviewTransition, REVIEW_ACTIONS, type PriceInput, type ReviewAction } from "@/server/pricing/review";
import { maybeTriggerPriceLookup } from "@/server/pricing/trigger";

export const dynamic = "force-dynamic";

type ReviewBody = {
  modelKey?: string;
  action?: string;
  price?: Partial<PriceInput>;
};

export async function POST(request: NextRequest) {
  const authz = await authorizeAdminRequest(request);
  if (!authz.ok) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as ReviewBody;
  const modelKey = typeof body.modelKey === "string" ? body.modelKey.trim() : "";
  const action = body.action as ReviewAction;
  if (!modelKey || !REVIEW_ACTIONS.includes(action)) {
    return Response.json({ error: "modelKey and a valid action are required" }, { status: 400 });
  }

  const current = await prisma.modelPrice.findUnique({ where: { modelKey } });
  if (!current) {
    return Response.json({ error: "unknown modelKey" }, { status: 404 });
  }

  const hasExistingPrice = current.input != null && current.output != null;
  const resolution = resolveReviewTransition(action, { hasExistingPrice, price: body.price });
  if (!resolution.ok) {
    const message = "error" in resolution ? resolution.error : "invalid review request";
    return Response.json({ error: message }, { status: 400 });
  }

  const now = new Date();
  const becomesApproved = resolution.data.status === MODEL_PRICE_STATUS.approved;
  const updated = await prisma.modelPrice.update({
    where: { modelKey },
    data: {
      ...resolution.data,
      reviewedById: authz.userId ?? undefined,
      ...(becomesApproved ? { pricedAt: current.pricedAt ?? now, verifiedAt: now } : {})
    }
  });

  // Refresh the price overlay + every cached dashboard at once, so an approval
  // reprices history immediately instead of waiting out the 30s cache TTL.
  revalidateTag(MODEL_PRICES_CACHE_TAG);

  // A relookup puts the row back to detected — kick the pipeline for it.
  if (updated.status === MODEL_PRICE_STATUS.detected) {
    await maybeTriggerPriceLookup([modelKey]);
  }

  return Response.json({ ok: true, modelKey, status: updated.status });
}
