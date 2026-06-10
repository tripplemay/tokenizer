import { describe, expect, it } from "vitest";
import { estimateCost, MODEL_PRICES, normalizeModelKey, sumCostAcrossModels } from "@/shared/model-pricing";

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
