// Domain vocabulary for the ModelPrice auto-pricing overlay. Kept in shared/
// so the effective-price provider, ingest detection, the admin routes, and the
// lookup pipeline all agree on the status set and which statuses are billable.

export const MODEL_PRICE_STATUS = {
  // Seen in usage data, no price yet — awaiting an automated lookup.
  detected: "detected",
  // A trusted structured source gave an exact, full-tier match — live cost.
  autoApplied: "auto_applied",
  // A price was derived/inferred but needs a human to confirm — NOT live.
  pendingReview: "pending_review",
  // A human confirmed (or hand-entered) the price — live cost.
  approved: "approved",
  // A human decided this stays unpriced.
  rejected: "rejected",
  // A lookup ran and found nothing usable — retried on the next scan.
  failed: "failed",
  // A human muted this model (e.g. an internal/test id we never want to price).
  ignored: "ignored"
} as const;

export type ModelPriceStatus = (typeof MODEL_PRICE_STATUS)[keyof typeof MODEL_PRICE_STATUS];

// Statuses whose price actually changes reported cost (enters the effective
// price table). Everything else is tracked-but-not-billable, which is what
// keeps "unpriced beats a guessed price" true until a trusted source or a human
// signs off.
export const BILLABLE_STATUSES: ModelPriceStatus[] = [
  MODEL_PRICE_STATUS.autoApplied,
  MODEL_PRICE_STATUS.approved
];

// Statuses a scan/lookup should (re)process: never seen, or a prior lookup that
// came up empty. detected models are new; failed models get another chance.
export const REPROCESSABLE_STATUSES: ModelPriceStatus[] = [
  MODEL_PRICE_STATUS.detected,
  MODEL_PRICE_STATUS.failed
];

// next/cache tag shared by getEffectivePrices() and every summary wrapper.
// A price approval calls revalidateTag(MODEL_PRICES_CACHE_TAG) to refresh both
// the price overlay and the cached dashboards at once.
export const MODEL_PRICES_CACHE_TAG = "model-prices";

// A trailing "-free" suffix (OpenRouter free-tier convention) means literal $0
// to the user, mirroring the hand-curated seed rows deepseek-v4-flash-free and
// minimax-m2.5-free. Detection auto-applies $0 for these instead of queuing a
// lookup. This is a convention, not a guarantee — an admin can re-classify.
export function isFreeConventionKey(modelKey: string): boolean {
  return modelKey.endsWith("-free");
}
