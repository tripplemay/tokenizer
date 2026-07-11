import { revalidateTag } from "next/cache";
import { prisma } from "../db";
import { MODEL_PRICES_CACHE_TAG, MODEL_PRICE_STATUS, REPROCESSABLE_STATUSES } from "@/shared/model-price";
import { toLiteLLMKeys, toOpenRouterId } from "./mapping";
import { classifyStructuredCandidates, parseLiteLLMPrice, parseOpenRouterPrice, type PriceCandidate } from "./sources";
import { fetchLiteLLMCatalog, fetchOpenRouterCatalog, liteLLMUrl, openRouterUrl } from "./catalog";
import { lookupPriceViaLLM } from "./llm-fallback";

function firstLiteLLMMatch(data: Record<string, unknown>, modelKey: string, url: string): PriceCandidate | null {
  for (const key of toLiteLLMKeys(modelKey)) {
    const candidate = parseLiteLLMPrice(data, key, url);
    if (candidate) return candidate;
  }
  return null;
}

// Guarded write: only touches a row STILL awaiting a lookup. Between the initial
// findMany and this write an admin may have approved/rejected/ignored the model
// via the review route (which keys the same unique modelKey); guarding on status
// here means a resolved human decision is never clobbered (count === 0 → skip).
// This closes the read-to-write TOCTOU across the ~20s catalog / ~30s LLM window.
async function updateIfPending(
  modelKey: string,
  data: Parameters<typeof prisma.modelPrice.updateMany>[0]["data"]
): Promise<number> {
  const res = await prisma.modelPrice.updateMany({
    where: { modelKey, status: { in: REPROCESSABLE_STATUSES } },
    data
  });
  return res.count;
}

// Resolve prices for the given keys. LiteLLM first (authoritative list price,
// four tiers, bare-key match for US first-party), OpenRouter for the long tail,
// then an optional LLM candidate — with the tiering in
// classifyStructuredCandidates deciding auto_applied vs pending_review. Runs
// out-of-band (via after()); safe to call with keys already resolved.
export async function runPriceLookups(modelKeys: string[]): Promise<void> {
  const keys = [...new Set(modelKeys.filter((k): k is string => Boolean(k)))];
  if (keys.length === 0) return;

  // Only touch rows still awaiting a lookup — a concurrent admin review may have
  // resolved some of them in the interim.
  const rows = await prisma.modelPrice.findMany({
    where: { modelKey: { in: keys }, status: { in: REPROCESSABLE_STATUSES } },
    select: { modelKey: true }
  });
  const pending = rows.map((row) => row.modelKey);
  if (pending.length === 0) return;

  // Fetch both catalogs once for the whole batch.
  const [liteLLM, openrouter] = await Promise.all([fetchLiteLLMCatalog(), fetchOpenRouterCatalog()]);
  const liteUrl = liteLLMUrl();

  let anyBillable = false;
  for (const modelKey of pending) {
    try {
      const liteCandidate = liteLLM ? firstLiteLLMMatch(liteLLM, modelKey, liteUrl) : null;
      const openRouterId = toOpenRouterId(modelKey);
      const openRouterCandidate =
        openrouter && openRouterId
          ? parseOpenRouterPrice(openrouter, openRouterId, `https://openrouter.ai/${openRouterId}`)
          : null;

      const structured = classifyStructuredCandidates(modelKey, liteCandidate, openRouterCandidate);
      if (structured) {
        const now = new Date();
        const applied = await updateIfPending(modelKey, {
          status: structured.status,
          input: structured.price.input,
          cacheRead: structured.price.cacheRead,
          cacheWrite: structured.price.cacheWrite,
          output: structured.price.output,
          source: structured.source,
          sourceUrl: structured.sourceUrl,
          confidence: structured.confidence,
          notes: structured.notes ?? null,
          pricedAt: now,
          verifiedAt: structured.status === MODEL_PRICE_STATUS.autoApplied ? now : null
        });
        // Only reprice if an auto_applied write actually landed on a pending row.
        if (applied > 0 && structured.status === MODEL_PRICE_STATUS.autoApplied) anyBillable = true;
        continue;
      }

      const llm = await lookupPriceViaLLM(modelKey);
      if (llm) {
        await updateIfPending(modelKey, {
          status: MODEL_PRICE_STATUS.pendingReview,
          input: llm.input,
          cacheRead: llm.cacheRead,
          cacheWrite: llm.cacheWrite,
          output: llm.output,
          source: "llm",
          sourceUrl: llm.sourceUrl,
          confidence: "low",
          notes: "LLM-suggested — verify against sourceUrl before approving",
          pricedAt: new Date(),
          rawLookup: llm.raw as object
        });
        continue;
      }

      await updateIfPending(modelKey, {
        status: MODEL_PRICE_STATUS.failed,
        notes: "no price found via litellm / openrouter / llm"
      });
    } catch (error) {
      console.error(`price lookup failed for ${modelKey}`, error);
      await updateIfPending(modelKey, { status: MODEL_PRICE_STATUS.failed, notes: String(error).slice(0, 200) }).catch(
        () => {}
      );
    }
  }

  // If any model became billable, refresh the overlay + dashboards immediately.
  if (anyBillable) revalidateTag(MODEL_PRICES_CACHE_TAG);
}
