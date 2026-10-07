import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_PRICES_CACHE_TAG } from "@/shared/model-price";

const mocks = vi.hoisted(() => ({ unstableCache: vi.fn() }));
vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("next/cache", () => ({
  unstable_cache: mocks.unstableCache.mockImplementation(() => async () => null),
  revalidateTag: vi.fn()
}));

import { getSummary, getDeviceSummary, getDailyCost } from "@/server/summaries";
import { invalidateUsageCostCache, usageCostCacheTag } from "@/server/usage-cost-cache";
import { revalidateTag } from "next/cache";
import { invalidateModelPricesCache } from "@/server/pricing/cache";

describe("summary cache tags", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses a bounded opaque tag for arbitrary tenant IDs", () => {
    const tag = usageCostCacheTag("tenant:" + "x".repeat(500));
    expect(tag).toMatch(/^usage-cost:[a-f0-9]{64}$/);
    expect(tag).toBe(usageCostCacheTag("tenant:" + "x".repeat(500)));
    expect(tag).not.toBe(usageCostCacheTag("another-tenant"));
  });

  it("scopes cached summaries, devices, and daily cost to the tenant and model prices", async () => {
    await getSummary("tenant-a", "all");
    await getDeviceSummary("tenant-b", "7d");
    await getDailyCost("tenant-a", "30d", "UTC");

    expect(mocks.unstableCache).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      ["getSummary", "tenant-a"],
      { revalidate: 30, tags: [MODEL_PRICES_CACHE_TAG, usageCostCacheTag("tenant-a")] }
    );
    expect(mocks.unstableCache).toHaveBeenNthCalledWith(
      2,
      expect.any(Function),
      ["getDeviceSummary", "tenant-b"],
      { revalidate: 30, tags: [MODEL_PRICES_CACHE_TAG, usageCostCacheTag("tenant-b")] }
    );
    expect(mocks.unstableCache).toHaveBeenNthCalledWith(
      3,
      expect.any(Function),
      ["getDailyCost", "tenant-a"],
      { revalidate: 30, tags: [MODEL_PRICES_CACHE_TAG, usageCostCacheTag("tenant-a")] }
    );
  });

  it("keeps a committed write successful if tag invalidation fails", () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(revalidateTag).mockImplementationOnce(() => { throw new Error("synthetic cache outage"); });
    expect(() => invalidateUsageCostCache("tenant-a")).not.toThrow();
    expect(logger).toHaveBeenCalledOnce();
    logger.mockRestore();
  });

  it("keeps a committed price write successful if tag invalidation fails", () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(revalidateTag).mockImplementationOnce(() => { throw new Error("synthetic cache outage"); });
    expect(() => invalidateModelPricesCache()).not.toThrow();
    expect(logger).toHaveBeenCalledOnce();
    logger.mockRestore();
  });
});
