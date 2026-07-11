import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_PRICES } from "@/shared/model-pricing";

const prismaMock = vi.hoisted(() => ({
  modelPrice: { findMany: vi.fn() }
}));

vi.mock("@/server/db", () => ({ prisma: prismaMock }));
// unstable_cache would try to reach Next's request cache; stub it to a
// pass-through so the module loads and behaves deterministically in node.
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

import { loadEffectivePrices } from "@/server/model-prices";

describe("loadEffectivePrices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the static seed unchanged when the overlay is empty", async () => {
    prismaMock.modelPrice.findMany.mockResolvedValue([]);
    const prices = await loadEffectivePrices();
    expect(prices).toEqual(MODEL_PRICES);
    // Only billable statuses are queried.
    expect(prismaMock.modelPrice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ["auto_applied", "approved"] } } })
    );
  });

  it("fills a new key from a billable overlay row (Decimal -> number)", async () => {
    prismaMock.modelPrice.findMany.mockResolvedValue([
      { modelKey: "brand-new-model", input: "2", cacheRead: "0.2", cacheWrite: "2.5", output: "8" }
    ]);
    const prices = await loadEffectivePrices();
    expect(prices["brand-new-model"]).toEqual({ input: 2, cacheRead: 0.2, cacheWrite: 2.5, output: 8 });
    // Seed keys are still present.
    expect(prices["claude-haiku-4-5"]).toEqual(MODEL_PRICES["claude-haiku-4-5"]);
  });

  it("defaults missing cache tiers to base input", async () => {
    prismaMock.modelPrice.findMany.mockResolvedValue([
      { modelKey: "flat-model", input: "1.5", cacheRead: null, cacheWrite: null, output: "4" }
    ]);
    const prices = await loadEffectivePrices();
    expect(prices["flat-model"]).toEqual({ input: 1.5, cacheRead: 1.5, cacheWrite: 1.5, output: 4 });
  });

  it("skips malformed rows missing base input or output (no invented price)", async () => {
    prismaMock.modelPrice.findMany.mockResolvedValue([
      { modelKey: "half-priced", input: "1", cacheRead: null, cacheWrite: null, output: null },
      { modelKey: "no-input", input: null, cacheRead: null, cacheWrite: null, output: "3" }
    ]);
    const prices = await loadEffectivePrices();
    expect(prices["half-priced"]).toBeUndefined();
    expect(prices["no-input"]).toBeUndefined();
  });

  it("lets an overlay row override a seed key (admin correction escape hatch)", async () => {
    prismaMock.modelPrice.findMany.mockResolvedValue([
      { modelKey: "claude-haiku-4-5", input: "99", cacheRead: "9.9", cacheWrite: "99", output: "99" }
    ]);
    const prices = await loadEffectivePrices();
    expect(prices["claude-haiku-4-5"]).toEqual({ input: 99, cacheRead: 9.9, cacheWrite: 99, output: 99 });
  });
});
