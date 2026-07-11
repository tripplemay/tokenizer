import { describe, expect, it } from "vitest";
import {
  classifyStructuredCandidates,
  deriveCacheTiers,
  parseLiteLLMPrice,
  parseOpenRouterPrice,
  priceAgrees,
  type PriceCandidate
} from "@/server/pricing/sources";

const LITELLM_URL = "https://litellm.example/prices.json";
const OR_URL = "https://openrouter.ai/anthropic/claude-opus-4.8";

describe("parseLiteLLMPrice", () => {
  it("converts per-token to per-1M and reads all four tiers", () => {
    const data = {
      "claude-opus-4-8": {
        input_cost_per_token: 5e-6,
        output_cost_per_token: 2.5e-5,
        cache_read_input_token_cost: 5e-7,
        cache_creation_input_token_cost: 6.25e-6
      }
    };
    expect(parseLiteLLMPrice(data, "claude-opus-4-8", LITELLM_URL)).toEqual({
      input: 5,
      output: 25,
      cacheRead: 0.5,
      cacheWrite: 6.25,
      source: "litellm",
      sourceUrl: LITELLM_URL
    });
  });

  it("returns null for a missing key or missing base price", () => {
    expect(parseLiteLLMPrice({}, "nope", LITELLM_URL)).toBe(null);
    expect(parseLiteLLMPrice({ x: { output_cost_per_token: 1e-6 } }, "x", LITELLM_URL)).toBe(null);
  });

  it("leaves cache tiers null when the source omits them", () => {
    const data = { "gpt-5.5": { input_cost_per_token: 5e-6, output_cost_per_token: 3e-5 } };
    const c = parseLiteLLMPrice(data, "gpt-5.5", LITELLM_URL);
    expect(c).toMatchObject({ input: 5, output: 30, cacheRead: null, cacheWrite: null });
  });
});

describe("parseOpenRouterPrice", () => {
  const models = [
    {
      id: "anthropic/claude-opus-4.8",
      pricing: { prompt: "0.000005", completion: "0.000025", input_cache_read: "0.0000005", input_cache_write: "0.00000625" }
    },
    { id: "deepseek/deepseek-v4-flash:free", pricing: { prompt: "0", completion: "0" } }
  ];

  it("parses string per-token prices to per-1M", () => {
    expect(parseOpenRouterPrice(models, "anthropic/claude-opus-4.8", OR_URL)).toEqual({
      input: 5,
      output: 25,
      cacheRead: 0.5,
      cacheWrite: 6.25,
      source: "openrouter",
      sourceUrl: OR_URL
    });
  });

  it("treats an explicit free tier as $0 (not unpriced)", () => {
    const c = parseOpenRouterPrice(models, "deepseek/deepseek-v4-flash:free", OR_URL);
    expect(c).toMatchObject({ input: 0, output: 0 });
  });

  it("returns null for an id not in the catalog", () => {
    expect(parseOpenRouterPrice(models, "openai/gpt-5.5", OR_URL)).toBe(null);
  });
});

describe("deriveCacheTiers", () => {
  it("keeps present tiers and reports not-derived", () => {
    expect(deriveCacheTiers("claude-opus-4-8", 5, 0.5, 6.25)).toEqual({ cacheRead: 0.5, cacheWrite: 6.25, derived: false });
  });

  it("derives Anthropic tiers from base input", () => {
    expect(deriveCacheTiers("claude-opus-4-8", 5, null, null)).toEqual({ cacheRead: 0.5, cacheWrite: 6.25, derived: true });
  });

  it("derives conservative (base-input) tiers for other vendors", () => {
    expect(deriveCacheTiers("gpt-5.5", 5, null, null)).toEqual({ cacheRead: 5, cacheWrite: 5, derived: true });
  });
});

describe("priceAgrees", () => {
  it("agrees within 1% and on exact zeros; conflicts on zero-vs-nonzero", () => {
    expect(priceAgrees(5, 5.02)).toBe(true); // 0.4%
    expect(priceAgrees(5, 5.2)).toBe(false); // 4%
    expect(priceAgrees(0, 0)).toBe(true);
    expect(priceAgrees(0, 1)).toBe(false);
  });
});

describe("classifyStructuredCandidates (the auto vs review tiering)", () => {
  const full: PriceCandidate = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, source: "litellm", sourceUrl: LITELLM_URL };
  const noCache: PriceCandidate = { input: 5, output: 30, cacheRead: null, cacheWrite: null, source: "openrouter", sourceUrl: OR_URL };

  it("auto-applies an exact full-tier match with no conflict", () => {
    const c = classifyStructuredCandidates("claude-opus-4-8", full, null);
    expect(c).toMatchObject({ status: "auto_applied", confidence: "high", source: "litellm" });
    expect(c?.price).toEqual({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 });
  });

  it("routes a derived-cache candidate to review", () => {
    const c = classifyStructuredCandidates("gpt-5.5", noCache, null);
    expect(c?.status).toBe("pending_review");
    expect(c?.price.cacheWrite).toBe(5); // derived to base input
  });

  it("routes conflicting sources to review", () => {
    const litellm: PriceCandidate = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, source: "litellm", sourceUrl: LITELLM_URL };
    const openrouter: PriceCandidate = { input: 6, output: 25, cacheRead: 0.6, cacheWrite: 7.5, source: "openrouter", sourceUrl: OR_URL };
    const c = classifyStructuredCandidates("claude-opus-4-8", litellm, openrouter);
    expect(c?.status).toBe("pending_review");
    expect(c?.notes).toMatch(/disagree/);
  });

  it("routes to review when only a CACHE tier disagrees >1% (input/output agree)", () => {
    const litellm: PriceCandidate = { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75, source: "litellm", sourceUrl: LITELLM_URL };
    // input/output identical; cacheRead 5x apart — must NOT auto-apply.
    const openrouter: PriceCandidate = { input: 15, output: 75, cacheRead: 7.5, cacheWrite: 18.75, source: "openrouter", sourceUrl: OR_URL };
    const c = classifyStructuredCandidates("claude-opus-4-8", litellm, openrouter);
    expect(c?.status).toBe("pending_review");
  });

  it("auto-applies when both sources agree and are full-tier", () => {
    const openrouter: PriceCandidate = { input: 5.01, output: 25, cacheRead: 0.5, cacheWrite: 6.25, source: "openrouter", sourceUrl: OR_URL };
    const c = classifyStructuredCandidates("claude-opus-4-8", full, openrouter);
    expect(c?.status).toBe("auto_applied");
  });

  it("returns null when no structured source has the model", () => {
    expect(classifyStructuredCandidates("mystery", null, null)).toBe(null);
  });
});
