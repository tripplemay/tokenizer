import { describe, expect, it } from "vitest";
import { computeSummaryMetrics } from "@/server/summary-metrics";

function totals(overrides: Partial<{ inputTokens: number; outputTokens: number; cachedInputTokens: number }> = {}) {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, ...overrides };
}

describe("computeSummaryMetrics", () => {
  it("returns zero metrics for an empty dataset", () => {
    expect(computeSummaryMetrics(totals())).toEqual({ billableTokens: 0, cacheHitRate: 0 });
  });

  it("billableTokens is input + output, excluding cache reads", () => {
    const metrics = computeSummaryMetrics(totals({ inputTokens: 100, outputTokens: 50, cachedInputTokens: 1_000_000 }));
    expect(metrics.billableTokens).toBe(150);
  });

  it("cacheHitRate is 0 when no cache reads have been recorded", () => {
    const metrics = computeSummaryMetrics(totals({ inputTokens: 100, outputTokens: 50 }));
    expect(metrics.cacheHitRate).toBe(0);
  });

  it("cacheHitRate is 1 when input is entirely served from cache", () => {
    const metrics = computeSummaryMetrics(totals({ cachedInputTokens: 1000 }));
    expect(metrics.cacheHitRate).toBe(1);
  });

  it("cacheHitRate divides cache reads by all input the model saw", () => {
    // 1000 cache reads on top of 250 fresh input = 1000 / 1250 = 0.8
    const metrics = computeSummaryMetrics(totals({ inputTokens: 250, cachedInputTokens: 1000 }));
    expect(metrics.cacheHitRate).toBeCloseTo(0.8, 6);
  });

  it("reproduces the dashboard scenario the user reported", () => {
    // 32M input + 3.7M output + 1.5B cache reads => 35.7M billable, ~97.9% cache hit
    const metrics = computeSummaryMetrics(totals({ inputTokens: 32_000_000, outputTokens: 3_700_000, cachedInputTokens: 1_500_000_000 }));
    expect(metrics.billableTokens).toBe(35_700_000);
    expect(metrics.cacheHitRate).toBeCloseTo(1_500_000_000 / (32_000_000 + 1_500_000_000), 6);
    expect(metrics.cacheHitRate).toBeGreaterThan(0.978);
    expect(metrics.cacheHitRate).toBeLessThan(0.98);
  });

  it("treats negative inputs as zero via Math.max guard", () => {
    // Defensive: aggregate sums should never be negative, but if they are, do not produce NaN.
    const metrics = computeSummaryMetrics(totals({ inputTokens: -10, outputTokens: -5, cachedInputTokens: -20 }));
    expect(metrics.billableTokens).toBe(0);
    expect(metrics.cacheHitRate).toBe(0);
  });
});
