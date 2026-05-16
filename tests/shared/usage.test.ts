import { describe, expect, it } from "vitest";
import { computeTotalTokens, normalizeTokenCount } from "@/shared/usage";

describe("normalizeTokenCount", () => {
  it("returns positive integers as-is", () => {
    expect(normalizeTokenCount(42)).toBe(42);
  });

  it("returns 0 for zero", () => {
    expect(normalizeTokenCount(0)).toBe(0);
  });

  it("truncates positive floats", () => {
    expect(normalizeTokenCount(42.7)).toBe(42);
  });

  it("clamps negative numbers to 0", () => {
    expect(normalizeTokenCount(-5)).toBe(0);
  });

  it("parses numeric strings", () => {
    expect(normalizeTokenCount("42")).toBe(42);
  });

  it("truncates numeric string floats", () => {
    expect(normalizeTokenCount("3.9")).toBe(3);
  });

  it("clamps negative numeric strings to 0", () => {
    expect(normalizeTokenCount("-3")).toBe(0);
  });

  it("returns 0 for non-numeric strings", () => {
    expect(normalizeTokenCount("abc")).toBe(0);
  });

  it("returns 0 for null", () => {
    expect(normalizeTokenCount(null)).toBe(0);
  });

  it("returns 0 for undefined", () => {
    expect(normalizeTokenCount(undefined)).toBe(0);
  });

  it("returns 0 for NaN", () => {
    expect(normalizeTokenCount(Number.NaN)).toBe(0);
  });

  it("returns 0 for Infinity", () => {
    expect(normalizeTokenCount(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("returns 0 for -Infinity", () => {
    expect(normalizeTokenCount(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it("returns 0 for plain objects", () => {
    expect(normalizeTokenCount({})).toBe(0);
  });

  it("returns 0 for arrays", () => {
    expect(normalizeTokenCount([])).toBe(0);
  });

  it("returns 0 for booleans", () => {
    expect(normalizeTokenCount(true)).toBe(0);
    expect(normalizeTokenCount(false)).toBe(0);
  });
});

describe("computeTotalTokens", () => {
  it("uses explicit totalTokens when greater than 0", () => {
    expect(computeTotalTokens({ totalTokens: 100, inputTokens: 5, outputTokens: 3 })).toBe(100);
  });

  it("falls back to input + output when totalTokens is 0", () => {
    expect(computeTotalTokens({ totalTokens: 0, inputTokens: 5, outputTokens: 3 })).toBe(8);
  });

  it("falls back to input + output when totalTokens is missing", () => {
    expect(computeTotalTokens({ inputTokens: 5, outputTokens: 3 })).toBe(8);
  });

  it("returns 0 when all fields missing", () => {
    expect(computeTotalTokens({})).toBe(0);
  });

  it("falls back to sum when totalTokens is negative (clamped to 0)", () => {
    expect(computeTotalTokens({ totalTokens: -5, inputTokens: 10, outputTokens: 2 })).toBe(12);
  });

  it("normalizes string token values", () => {
    expect(computeTotalTokens({ totalTokens: "50" as unknown as number, inputTokens: 1, outputTokens: 2 })).toBe(50);
  });

  it("normalizes string sum when explicit total absent", () => {
    expect(
      computeTotalTokens({
        inputTokens: "10" as unknown as number,
        outputTokens: "20" as unknown as number
      })
    ).toBe(30);
  });
});
