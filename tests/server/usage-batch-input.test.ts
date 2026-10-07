import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateDeviceToken: vi.fn(),
  updateTimezone: vi.fn(),
  detectAndTrackUnpricedModels: vi.fn(),
  maybeTriggerPriceLookup: vi.fn(),
  invalidateUsageCostCache: vi.fn(),
  prisma: {
    device: { upsert: vi.fn() },
    deviceToken: { update: vi.fn() },
    project: { findFirst: vi.fn(), create: vi.fn() },
    usageEvent: { createMany: vi.fn() }
  }
}));

vi.mock("@/server/auth", () => ({
  authenticateDeviceToken: mocks.authenticateDeviceToken,
  unauthorized: () => Response.json({ error: "unauthorized" }, { status: 401 }),
  forbidden: (message: string) => Response.json({ error: message }, { status: 403 })
}));
vi.mock("@/server/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/server/timezone", () => ({ updateUserTimezoneIfValid: mocks.updateTimezone }));
vi.mock("@/server/pricing/detect", () => ({ detectAndTrackUnpricedModels: mocks.detectAndTrackUnpricedModels }));
vi.mock("@/server/pricing/trigger", () => ({ maybeTriggerPriceLookup: mocks.maybeTriggerPriceLookup }));
vi.mock("@/server/usage-cost-cache", () => ({ invalidateUsageCostCache: mocks.invalidateUsageCostCache }));

import { POST } from "../../app/api/usage/events/batch/route";

function request(poison = false) {
  return new Request("http://localhost/api/usage/events/batch", {
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify({
      device: {
        id: "device-1",
        name: poison ? `Desk\u0000agent${"x".repeat(300)}` : "Desk agent"
      },
      events: [
        {
          source: poison ? `kimicode\u0001${"x".repeat(200)}` : "kimicode",
          sourceEventId: "event-1",
          model: "new-model",
          occurredAt: "2026-08-10T00:00:00.000Z",
          inputTokens: 2,
          outputTokens: 3
        }
      ]
    })
  }) as never;
}

describe("usage batch hot-path input cleaning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateDeviceToken.mockResolvedValue({ id: "token-1", userId: "user-1", deviceId: "device-1", device: { id: "device-1", userId: "user-1" } });
    mocks.prisma.device.upsert.mockResolvedValue({ id: "device-1" });
    mocks.prisma.deviceToken.update.mockResolvedValue({});
    mocks.prisma.project.findFirst.mockResolvedValue(null);
    mocks.prisma.project.create.mockResolvedValue({ id: "project-1" });
    mocks.prisma.usageEvent.createMany.mockImplementation(({ data }: { data: unknown[] }) =>
      Promise.resolve({ count: data.length })
    );
    mocks.detectAndTrackUnpricedModels.mockResolvedValue([]);
  });

  it("rejects the former poison batch before any business writes", async () => {
    const response = await POST(request(true));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid batch request", code: "invalid_json" });
    expect(mocks.prisma.device.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.deviceToken.update).not.toHaveBeenCalled();
    expect(mocks.prisma.usageEvent.createMany).not.toHaveBeenCalled();
    expect(mocks.updateTimezone).not.toHaveBeenCalled();
    expect(mocks.invalidateUsageCostCache).not.toHaveBeenCalled();
  });

  it("preserves legitimate old Agent fields and successful cache invalidation", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.prisma.usageEvent.createMany.mock.calls[0][0].data[0].source).toBe("kimicode");
    expect(mocks.invalidateUsageCostCache).toHaveBeenCalledOnce();
    expect(mocks.invalidateUsageCostCache).toHaveBeenCalledWith("user-1");
  });

  it("does not invalidate cost when a batch contains only duplicates", async () => {
    mocks.prisma.usageEvent.createMany.mockResolvedValueOnce({ count: 0 });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.invalidateUsageCostCache).not.toHaveBeenCalled();
  });
});
