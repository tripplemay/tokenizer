import { vendorFamily } from "./mapping";
import type { PriceInput } from "./review";

// A price parsed from one external source. cacheRead/cacheWrite are null when the
// source did not publish them (must be derived, which lowers confidence). All
// four figures are USD per 1M tokens once parsed.
export type PriceCandidate = {
  input: number;
  output: number;
  cacheRead: number | null;
  cacheWrite: number | null;
  source: "litellm" | "openrouter";
  sourceUrl: string;
};

// External feeds quote USD per single token; we store per 1M tokens.
function perMillion(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return n * 1_000_000;
}

type LiteLLMEntry = {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
};

// Parse a LiteLLM model_prices entry for an exact key. Returns null if the key
// is absent or lacks base input/output — never invents a price.
export function parseLiteLLMPrice(
  data: Record<string, unknown>,
  liteLLMKey: string,
  sourceUrl: string
): PriceCandidate | null {
  const entry = data[liteLLMKey] as LiteLLMEntry | undefined;
  if (!entry || typeof entry !== "object") return null;
  const input = perMillion(entry.input_cost_per_token);
  const output = perMillion(entry.output_cost_per_token);
  if (input == null || output == null) return null;
  return {
    input,
    output,
    cacheRead: perMillion(entry.cache_read_input_token_cost),
    cacheWrite: perMillion(entry.cache_creation_input_token_cost),
    source: "litellm",
    sourceUrl
  };
}

type OpenRouterModel = {
  id?: string;
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
    input_cache_read?: string | number;
    input_cache_write?: string | number;
  };
};

// Parse an OpenRouter /models entry for an exact id.
export function parseOpenRouterPrice(
  models: OpenRouterModel[],
  openRouterId: string,
  sourceUrl: string
): PriceCandidate | null {
  const entry = models.find((m) => m.id === openRouterId);
  if (!entry?.pricing) return null;
  const input = perMillion(entry.pricing.prompt);
  const output = perMillion(entry.pricing.completion);
  if (input == null || output == null) return null;
  return {
    input,
    output,
    cacheRead: perMillion(entry.pricing.input_cache_read),
    cacheWrite: perMillion(entry.pricing.input_cache_write),
    source: "openrouter",
    sourceUrl
  };
}

// Fill missing cache tiers using documented per-vendor conventions. When a tier
// has to be derived we flag it — derivation is an assumption, so the caller
// routes such candidates to human review rather than auto-applying them.
export function deriveCacheTiers(
  modelKey: string,
  input: number,
  cacheRead: number | null,
  cacheWrite: number | null
): { cacheRead: number; cacheWrite: number; derived: boolean } {
  if (cacheRead != null && cacheWrite != null) {
    return { cacheRead, cacheWrite, derived: false };
  }
  if (vendorFamily(modelKey) === "anthropic") {
    // Anthropic: cache read = 0.1x input, 5-min cache write = 1.25x input.
    return { cacheRead: cacheRead ?? input * 0.1, cacheWrite: cacheWrite ?? input * 1.25, derived: true };
  }
  // Everyone else: no documented cache-write premium; an unknown cache read is
  // charged at base input (conservative overcharge, never an undercharge).
  return { cacheRead: cacheRead ?? input, cacheWrite: cacheWrite ?? input, derived: true };
}

// Relative agreement within tolerance (default 1%). Two exact zeros agree; a
// zero vs a non-zero is a conflict.
export function priceAgrees(a: number, b: number, tolerance = 0.01): boolean {
  if (a === b) return true;
  const denom = Math.max(Math.abs(a), Math.abs(b));
  if (denom === 0) return true;
  return Math.abs(a - b) / denom <= tolerance;
}

export type Classification = {
  status: "auto_applied" | "pending_review";
  confidence: "high" | "low";
  price: PriceInput;
  source: string;
  sourceUrl: string;
  notes?: string;
};

// The tiering rule that reconciles "auto-price" with "never guess": auto-apply
// ONLY when a trusted structured source gave an exact match with all four tiers
// present AND (if both sources hit) they agree. Anything derived or in conflict
// becomes a pending_review candidate — visible, pre-filled, but not billable
// until a human signs off. Returns null when no structured source had the model.
export function classifyStructuredCandidates(
  modelKey: string,
  litellm: PriceCandidate | null,
  openrouter: PriceCandidate | null
): Classification | null {
  const primary = litellm ?? openrouter;
  if (!primary) return null;

  const conflict =
    litellm != null &&
    openrouter != null &&
    (!priceAgrees(litellm.input, openrouter.input) ||
      !priceAgrees(litellm.output, openrouter.output) ||
      // A cache tier only conflicts when BOTH sources report it — a tier one
      // source omits is derived, not disputed.
      (litellm.cacheRead != null && openrouter.cacheRead != null && !priceAgrees(litellm.cacheRead, openrouter.cacheRead)) ||
      (litellm.cacheWrite != null && openrouter.cacheWrite != null && !priceAgrees(litellm.cacheWrite, openrouter.cacheWrite)));

  const tiers = deriveCacheTiers(modelKey, primary.input, primary.cacheRead, primary.cacheWrite);
  const price: PriceInput = {
    input: primary.input,
    output: primary.output,
    cacheRead: tiers.cacheRead,
    cacheWrite: tiers.cacheWrite
  };

  if (!conflict && !tiers.derived) {
    return { status: "auto_applied", confidence: "high", price, source: primary.source, sourceUrl: primary.sourceUrl };
  }
  return {
    status: "pending_review",
    confidence: "low",
    price,
    source: primary.source,
    sourceUrl: primary.sourceUrl,
    notes: conflict ? "litellm/openrouter disagree >1% — review" : "cache tiers derived — review"
  };
}
