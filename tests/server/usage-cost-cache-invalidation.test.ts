import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isAdminAuthorized: vi.fn(),
  invalidateUsageCostCache: vi.fn(),
  usageEvent: { findMany: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  transaction: vi.fn()
}));

vi.mock("@/server/auth", () => ({
  isAdminAuthorized: mocks.isAdminAuthorized,
  unauthorized: () => Response.json({ error: "unauthorized" }, { status: 401 })
}));
vi.mock("@/server/db", () => ({
  prisma: { usageEvent: mocks.usageEvent, $transaction: mocks.transaction }
}));
vi.mock("@/server/usage-cost-cache", () => ({ invalidateUsageCostCache: mocks.invalidateUsageCostCache }));

import { POST } from "../../app/api/admin/cleanup-claude-legacy/route";

const oldRows = [
  { id: "r1", userId: "user-a", deviceId: "device-a", sessionId: "session-a", totalTokens: 100, sourceEventId: "claude:one" },
  { id: "r2", userId: "user-a", deviceId: "device-a", sessionId: "session-a", totalTokens: 200, sourceEventId: "claude:two" },
  { id: "r3", userId: "user-b", deviceId: "device-b", sessionId: "session-b", totalTokens: 50, sourceEventId: "claude:three" }
];

function request(dryRun: boolean) {
  return new Request("http://localhost/api/admin/cleanup-claude-legacy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dryRun })
  }) as never;
}

describe("legacy usage cleanup invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAdminAuthorized.mockReturnValue(true);
    mocks.usageEvent.findMany.mockResolvedValueOnce(oldRows).mockResolvedValueOnce([]);
    mocks.transaction.mockResolvedValue([]);
  });

  it("does not invalidate or mutate during a dry run", async () => {
    const response = await POST(request(true));
    expect(response.status).toBe(200);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.invalidateUsageCostCache).not.toHaveBeenCalled();
  });

  it("invalidates only affected tenants after committed deletion and correction", async () => {
    const response = await POST(request(false));
    expect(response.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.invalidateUsageCostCache.mock.calls).toEqual([["user-a"], ["user-b"]]);
  });

  it("does not invalidate if the cleanup transaction fails", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("synthetic database failure"));
    await expect(POST(request(false))).rejects.toThrow("synthetic database failure");
    expect(mocks.invalidateUsageCostCache).not.toHaveBeenCalled();
  });
});
