import { describe, expect, it } from "vitest";
import { normalizePrice, resolveReviewTransition } from "@/server/pricing/review";

describe("normalizePrice", () => {
  it("requires both input and output", () => {
    expect(normalizePrice({ input: 1 })).toBe(null);
    expect(normalizePrice({ output: 1 })).toBe(null);
    expect(normalizePrice(null)).toBe(null);
    expect(normalizePrice(undefined)).toBe(null);
  });

  it("defaults missing cache tiers to base input", () => {
    expect(normalizePrice({ input: 2, output: 8 })).toEqual({ input: 2, cacheRead: 2, cacheWrite: 2, output: 8 });
  });

  it("keeps explicit cache tiers", () => {
    expect(normalizePrice({ input: 5, cacheRead: 0.5, cacheWrite: 6.25, output: 25 })).toEqual({
      input: 5,
      cacheRead: 0.5,
      cacheWrite: 6.25,
      output: 25
    });
  });

  it("rejects negative or non-finite values", () => {
    expect(normalizePrice({ input: -1, output: 8 })).toBe(null);
    expect(normalizePrice({ input: Number.NaN, output: 8 })).toBe(null);
    expect(normalizePrice({ input: 2, output: Number.POSITIVE_INFINITY })).toBe(null);
  });
});

describe("resolveReviewTransition", () => {
  it("blocks a bare approve when the row has no price", () => {
    const r = resolveReviewTransition("approve", { hasExistingPrice: false });
    expect(r.ok).toBe(false);
  });

  it("approves a row that already carries a price", () => {
    expect(resolveReviewTransition("approve", { hasExistingPrice: true })).toEqual({
      ok: true,
      data: { status: "approved" }
    });
  });

  it("edit validates the price and marks it manual/approved", () => {
    expect(resolveReviewTransition("edit", { hasExistingPrice: false, price: { input: 2, output: 8 } })).toEqual({
      ok: true,
      data: { status: "approved", input: 2, cacheRead: 2, cacheWrite: 2, output: 8, source: "manual", confidence: "high" }
    });
    expect(resolveReviewTransition("edit", { hasExistingPrice: false, price: { input: 2 } }).ok).toBe(false);
  });

  it("reject and ignore set their status without touching price", () => {
    expect(resolveReviewTransition("reject", { hasExistingPrice: true })).toEqual({ ok: true, data: { status: "rejected" } });
    expect(resolveReviewTransition("ignore", { hasExistingPrice: true })).toEqual({ ok: true, data: { status: "ignored" } });
  });

  it("relookup resets to detected and clears price AND stale approval metadata", () => {
    expect(resolveReviewTransition("relookup", { hasExistingPrice: true })).toEqual({
      ok: true,
      data: {
        status: "detected",
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
    });
  });
});
