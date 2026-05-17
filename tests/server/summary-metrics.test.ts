import { describe, expect, it } from "vitest";
import { computeSummaryMetrics } from "@/server/summary-metrics";

function totals(overrides: Partial<{ inputTokens: number; outputTokens: number; cachedInputTokens: number }> = {}) {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, ...overrides };
}

describe("computeSummaryMetrics", () => {
  it("returns zero metrics for an empty dataset", () => {
    expect(computeSummaryMetrics(totals())).toEqual({ billableTokens: 0, cacheHitRate: 0 });
  });

  it("billableTokens = (inputTokens - cachedInputTokens) + outputTokens", () => {
    // inputTokens is total input (incl. cache); subtract cache reads to get
    // the fresh portion, add output for "new compute".
    // 1000100 (incl 1M cache reads) - 1000000 cached + 50 output = 150
    const metrics = computeSummaryMetrics(totals({ inputTokens: 1000100, outputTokens: 50, cachedInputTokens: 1000000 }));
    expect(metrics.billableTokens).toBe(150);
  });

  it("cacheHitRate is 0 when no cache reads have been recorded", () => {
    const metrics = computeSummaryMetrics(totals({ inputTokens: 100, outputTokens: 50 }));
    expect(metrics.cacheHitRate).toBe(0);
  });

  it("cacheHitRate is 1 when input is entirely served from cache", () => {
    const metrics = computeSummaryMetrics(totals({ inputTokens: 1000, cachedInputTokens: 1000 }));
    expect(metrics.cacheHitRate).toBe(1);
  });

  it("cacheHitRate = cachedInputTokens / inputTokens (input already includes cached)", () => {
    // 1000 cache reads in a 1250-total input → 1000/1250 = 0.8
    const metrics = computeSummaryMetrics(totals({ inputTokens: 1250, cachedInputTokens: 1000 }));
    expect(metrics.cacheHitRate).toBeCloseTo(0.8, 6);
  });

  it("reproduces the dashboard scenario", () => {
    // Under new semantic, the user's data: input includes cache reuse
    // input = 1.532B (incl 1.5B cache reads + 32M fresh), output = 3.7M, cached = 1.5B
    const inputTotal = 32_000_000 + 1_500_000_000;
    const metrics = computeSummaryMetrics(totals({
      inputTokens: inputTotal,
      outputTokens: 3_700_000,
      cachedInputTokens: 1_500_000_000
    }));
    // billable = (input - cached) + output = 32M + 3.7M = 35.7M
    expect(metrics.billableTokens).toBe(35_700_000);
    // hit rate = 1.5B / 1.532B ≈ 0.9791
    expect(metrics.cacheHitRate).toBeCloseTo(1_500_000_000 / inputTotal, 6);
    expect(metrics.cacheHitRate).toBeGreaterThan(0.978);
    expect(metrics.cacheHitRate).toBeLessThan(0.98);
  });

  it("treats negative inputs as zero via Math.max guard", () => {
    const metrics = computeSummaryMetrics(totals({ inputTokens: -10, outputTokens: -5, cachedInputTokens: -20 }));
    expect(metrics.billableTokens).toBe(0);
    expect(metrics.cacheHitRate).toBe(0);
  });

  it("clamps cacheHitRate to 1 when cached exceeds input (defensive)", () => {
    // Shouldn't happen under new semantic (cache is a subset) but guard anyway.
    const metrics = computeSummaryMetrics(totals({ inputTokens: 100, cachedInputTokens: 200 }));
    expect(metrics.cacheHitRate).toBe(1);
  });
});
