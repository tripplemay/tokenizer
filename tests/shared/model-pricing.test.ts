import { describe, expect, it } from "vitest";
import { decomposeCost, estimateCost, getModelPrice, MODEL_PRICES, normalizeModelKey, sumCostAcrossModels } from "@/shared/model-pricing";

describe("normalizeModelKey", () => {
  it("returns null for nullish input", () => {
    expect(normalizeModelKey(null)).toBe(null);
    expect(normalizeModelKey(undefined)).toBe(null);
    expect(normalizeModelKey("")).toBe(null);
  });

  it("lowercases and strips a trailing -YYYYMMDD date suffix", () => {
    expect(normalizeModelKey("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
    expect(normalizeModelKey("Claude-Sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  it("leaves keys without a date suffix untouched", () => {
    expect(normalizeModelKey("claude-opus-4-7")).toBe("claude-opus-4-7");
    expect(normalizeModelKey("gpt-5.5")).toBe("gpt-5.5");
  });
});

describe("estimateCost", () => {
  it("returns null for an unknown model", () => {
    expect(estimateCost("big-pickle", { inputTokens: 100, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 50 })).toBe(null);
  });

  it("handles a vendor with no cache (Haiku-style: cached/cacheWrite=0)", () => {
    // input 1000 @ $1, output 500 @ $5  →  0.001 + 0.0025 = 0.0035 USD
    const cost = estimateCost("claude-haiku-4-5", { inputTokens: 1000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 500 });
    expect(cost).toBeCloseTo(0.0035, 6);
  });

  it("decomposes an Opus 4.7 event correctly (input includes cached + cacheWrite)", () => {
    // inputTokens = 1000 (= 100 fresh + 800 cached + 100 cacheWrite)
    // fresh:       100 * $5    / 1e6 = 0.000500
    // cache read:  800 * $0.50 / 1e6 = 0.000400
    // cache write: 100 * $6.25 / 1e6 = 0.000625
    // output:      500 * $25   / 1e6 = 0.012500
    // total:                           0.014025
    const cost = estimateCost("claude-opus-4-7", {
      inputTokens: 1000,
      cachedInputTokens: 800,
      cacheWriteTokens: 100,
      outputTokens: 500
    });
    expect(cost).toBeCloseTo(0.014025, 6);
  });

  it("clamps fresh input to 0 when stale data has cached + cacheWrite > input", () => {
    // Defensive: an inconsistent row shouldn't produce a negative fresh-input term.
    const cost = estimateCost("claude-opus-4-7", {
      inputTokens: 100,
      cachedInputTokens: 90,
      cacheWriteTokens: 50,
      outputTokens: 0
    });
    // fresh clamps to 0; we still charge for cache read (90 * 0.5 / 1e6 = 0.000045)
    // and cache write (50 * 6.25 / 1e6 = 0.0003125).
    expect(cost).toBeCloseTo(0.000045 + 0.0003125, 8);
  });

  it("normalises a model key with a date suffix before lookup", () => {
    const cost = estimateCost("claude-haiku-4-5-20251001", { inputTokens: 1000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 });
    expect(cost).toBeCloseTo(0.001, 6);
  });

  it("prices every model in the static table without throwing", () => {
    for (const key of Object.keys(MODEL_PRICES)) {
      const cost = estimateCost(key, { inputTokens: 1_000_000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 });
      expect(cost).toBeCloseTo(MODEL_PRICES[key].input, 6);
    }
  });

  it("covers every model that has appeared in production usage data", () => {
    // Guardrails: if a new model name shows up in DB we want a test failure
    // here rather than silent $0 cost reporting. Update this list whenever
    // distinct(model) changes upstream.
    const observedModels = [
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-fable-5",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex",
      "gpt-5.2",
      "gpt-5.1-codex",
      "gpt-5.1-codex-mini",
      "gemini-3.1-pro-preview",
      "kimi-for-coding",
      "kimi-code/k3",
      "deepseek-v4-pro",
      "deepseek-v4-flash-free",
      "glm-5",
      "glm-4.7",
      "mimo-v2.5-pro",
      "minimax-m2.5-free"
    ];
    for (const model of observedModels) {
      const cost = estimateCost(model, { inputTokens: 1000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 500 });
      expect(cost, `expected ${model} to be priced`).not.toBeNull();
    }
  });
});

describe("sumCostAcrossModels", () => {
  it("sums priced rows and accumulates unpriced token counts", () => {
    const { cost, unpricedTokens } = sumCostAcrossModels([
      { model: "claude-haiku-4-5", inputTokens: 1000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 500 },
      { model: "big-pickle", inputTokens: 200, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 100 },
      { model: null, inputTokens: 50, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 25 }
    ]);
    expect(cost).toBeCloseTo(0.0035, 6);
    expect(unpricedTokens).toBe(200 + 100 + 50 + 25);
  });
});

// The optional `prices` param is how the server threads the DB-backed
// auto-pricing overlay (src/server/model-prices.ts) into the pure math. These
// tests pin the overlay semantics without touching any DB.
describe("effective-price overlay (prices param)", () => {
  const overlay = {
    ...MODEL_PRICES,
    // A model the static seed does not know about, learned at runtime.
    "brand-new-model": { input: 2, cacheRead: 0.2, cacheWrite: 2, output: 8 }
  };

  it("prices a model present only in the overlay, still null without it", () => {
    const tokens = { inputTokens: 1_000_000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
    expect(estimateCost("brand-new-model", tokens)).toBe(null); // seed default: unpriced
    expect(estimateCost("brand-new-model", tokens, overlay)).toBeCloseTo(2, 6);
  });

  it("normalises the date suffix before hitting the overlay", () => {
    const tokens = { inputTokens: 1_000_000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
    expect(estimateCost("Brand-New-Model-20260710", tokens, overlay)).toBeCloseTo(2, 6);
  });

  it("keeps null-means-unpriced for keys absent from the supplied table", () => {
    const tokens = { inputTokens: 100, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 50 };
    expect(estimateCost("still-unknown", tokens, overlay)).toBe(null);
    const { unpricedTokens } = sumCostAcrossModels(
      [{ model: "still-unknown", inputTokens: 100, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 50 }],
      overlay
    );
    expect(unpricedTokens).toBe(150);
  });

  it("lets an overlay entry override a seed key (admin correction escape hatch)", () => {
    const corrected = { ...MODEL_PRICES, "claude-haiku-4-5": { input: 99, cacheRead: 9.9, cacheWrite: 99, output: 99 } };
    const tokens = { inputTokens: 1_000_000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
    expect(estimateCost("claude-haiku-4-5", tokens)).toBeCloseTo(1, 6); // seed
    expect(estimateCost("claude-haiku-4-5", tokens, corrected)).toBeCloseTo(99, 6); // overlay wins
  });

  it("getModelPrice and decomposeCost honour the overlay too", () => {
    expect(getModelPrice("brand-new-model")).toBe(null);
    expect(getModelPrice("brand-new-model", overlay)).toEqual({ input: 2, cacheRead: 0.2, cacheWrite: 2, output: 8 });
    const breakdown = decomposeCost(
      "brand-new-model",
      { inputTokens: 1_000_000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1_000_000 },
      overlay
    );
    expect(breakdown?.total).toBeCloseTo(2 + 8, 6);
  });
});
