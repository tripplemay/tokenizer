import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeAdminRequest: vi.fn(),
  invalidateModelPricesCache: vi.fn(),
  maybeTriggerPriceLookup: vi.fn(),
  usageEvent: { groupBy: vi.fn() },
  modelPrice: { findMany: vi.fn(), createMany: vi.fn() }
}));
vi.mock("@/server/admin-auth", () => ({ authorizeAdminRequest: mocks.authorizeAdminRequest }));
vi.mock("@/server/db", () => ({ prisma: { usageEvent: mocks.usageEvent, modelPrice: mocks.modelPrice } }));
vi.mock("@/server/pricing/cache", () => ({ invalidateModelPricesCache: mocks.invalidateModelPricesCache }));
vi.mock("@/server/pricing/trigger", () => ({ maybeTriggerPriceLookup: mocks.maybeTriggerPriceLookup }));

import { POST } from "../../app/api/admin/pricing/scan/route";

function request(dryRun: boolean) {
  return new Request("http://localhost/api/admin/pricing/scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dryRun })
  }) as never;
}

describe("pricing scan cache invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeAdminRequest.mockResolvedValue({ ok: true, userId: "admin" });
    mocks.usageEvent.groupBy.mockResolvedValue([{ model: "synthetic-scan-free", _sum: { totalTokens: 100 } }]);
    mocks.modelPrice.findMany.mockResolvedValue([]);
    mocks.modelPrice.createMany.mockResolvedValue({ count: 1 });
  });

  it("does not invalidate on preview", async () => {
    const response = await POST(request(true));
    expect(response.status).toBe(200);
    expect(mocks.modelPrice.createMany).not.toHaveBeenCalled();
    expect(mocks.invalidateModelPricesCache).not.toHaveBeenCalled();
  });

  it("invalidates after a newly auto-applied free price is committed", async () => {
    const response = await POST(request(false));
    expect(response.status).toBe(200);
    expect(mocks.modelPrice.createMany).toHaveBeenCalledOnce();
    expect(mocks.invalidateModelPricesCache).toHaveBeenCalledOnce();
  });

  it("does not invalidate if all planned rows lost a concurrent insert race", async () => {
    mocks.modelPrice.createMany.mockResolvedValueOnce({ count: 0 });
    const response = await POST(request(false));
    expect(response.status).toBe(200);
    expect(mocks.invalidateModelPricesCache).not.toHaveBeenCalled();
  });
});
