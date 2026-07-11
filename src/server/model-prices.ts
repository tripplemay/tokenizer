import { unstable_cache } from "next/cache";
import { prisma } from "./db";
import { MODEL_PRICES, type ModelPriceRow } from "@/shared/model-pricing";
import { BILLABLE_STATUSES, MODEL_PRICES_CACHE_TAG } from "@/shared/model-price";

// Prisma.Decimal | null -> number | null. Prices are small enough that a plain
// Number() conversion is exact; we guard against NaN defensively.
function toNum(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Build the effective price table = static seed merged with the billable rows
// of the DB overlay. Exported uncached so tests and callers that must not read
// a stale table (e.g. deciding what is unpriced *right now*) can use it.
export async function loadEffectivePrices(): Promise<Record<string, ModelPriceRow>> {
  const rows = await prisma.modelPrice.findMany({
    where: { status: { in: BILLABLE_STATUSES } },
    select: { modelKey: true, input: true, cacheRead: true, cacheWrite: true, output: true }
  });

  const overlay: Record<string, ModelPriceRow> = {};
  for (const row of rows) {
    const input = toNum(row.input);
    const output = toNum(row.output);
    // A billable row must carry at least base input + output. Skip malformed
    // rows rather than invent a price — that keeps null-means-unpriced honest.
    if (input == null || output == null) continue;
    overlay[row.modelKey] = {
      input,
      // A missing cache tier falls back to base input (no discount/premium) —
      // the same conservative default the seed uses for cache-less vendors.
      cacheRead: toNum(row.cacheRead) ?? input,
      cacheWrite: toNum(row.cacheWrite) ?? input,
      output
    };
  }

  // DB overlay wins over the seed. Detection/scan never create rows for keys the
  // seed already defines, so in practice the overlay only *fills* new keys; a
  // seed-key row exists only via a deliberate admin correction, honoured here.
  return { ...MODEL_PRICES, ...overlay };
}

// Cached accessor for the render path. 30s TTL matches the summary caches; a
// price approval calls revalidateTag(MODEL_PRICES_CACHE_TAG) to refresh the
// overlay and every dashboard immediately (see app/api/admin/pricing/review).
export const getEffectivePrices = unstable_cache(loadEffectivePrices, ["effective-model-prices"], {
  revalidate: 30,
  tags: [MODEL_PRICES_CACHE_TAG]
});
