import { MODEL_PRICE_STATUS } from "@/shared/model-price";

export type PriceInput = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
};

export type ReviewAction = "approve" | "edit" | "reject" | "ignore" | "relookup";

export const REVIEW_ACTIONS: ReviewAction[] = ["approve", "edit", "reject", "ignore", "relookup"];

function coerce(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

// Validate & complete an admin-entered price. input and output are mandatory;
// missing cache tiers default to base input (no discount/premium) — the same
// conservative convention getEffectivePrices() uses. Returns null if the price
// is not usable, so we never persist a half-specified/negative price.
export function normalizePrice(price?: Partial<PriceInput> | null): PriceInput | null {
  if (!price) return null;
  const input = coerce(price.input);
  const output = coerce(price.output);
  if (input == null || output == null) return null;
  return {
    input,
    cacheRead: coerce(price.cacheRead) ?? input,
    cacheWrite: coerce(price.cacheWrite) ?? input,
    output
  };
}

export type ReviewResolution =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

// Pure state-machine for a review decision. Returns the ModelPrice column patch
// to apply; the route stamps timestamps / reviewer id and calls revalidateTag.
// `hasExistingPrice` gates a bare approve: you cannot approve a row that carries
// no price (a detected/failed row) — you must `edit` a price in first.
export function resolveReviewTransition(
  action: ReviewAction,
  opts: { hasExistingPrice: boolean; price?: Partial<PriceInput> | null }
): ReviewResolution {
  switch (action) {
    case "approve":
      if (!opts.hasExistingPrice) {
        return { ok: false, error: "no price to approve — use edit to set one first" };
      }
      return { ok: true, data: { status: MODEL_PRICE_STATUS.approved } };
    case "edit": {
      const price = normalizePrice(opts.price);
      if (!price) {
        return { ok: false, error: "invalid price — input and output must be non-negative numbers" };
      }
      return {
        ok: true,
        data: {
          status: MODEL_PRICE_STATUS.approved,
          input: price.input,
          cacheRead: price.cacheRead,
          cacheWrite: price.cacheWrite,
          output: price.output,
          source: "manual",
          confidence: "high"
        }
      };
    }
    case "reject":
      return { ok: true, data: { status: MODEL_PRICE_STATUS.rejected } };
    case "ignore":
      return { ok: true, data: { status: MODEL_PRICE_STATUS.ignored } };
    case "relookup":
      // Reset to detected and clear any inferred price AND stale approval
      // metadata so the row is a clean detected state; while detected it
      // contributes nothing to billing.
      return {
        ok: true,
        data: {
          status: MODEL_PRICE_STATUS.detected,
          input: null,
          cacheRead: null,
          cacheWrite: null,
          output: null,
          source: null,
          sourceUrl: null,
          confidence: null,
          notes: null,
          pricedAt: null,
          verifiedAt: null
        }
      };
    default:
      return { ok: false, error: `unknown action: ${String(action)}` };
  }
}
