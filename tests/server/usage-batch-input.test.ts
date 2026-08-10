import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateDeviceToken: vi.fn(),
  updateTimezone: vi.fn(),
  detectAndTrackUnpricedModels: vi.fn(),
  maybeTriggerPriceLookup: vi.fn(),
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

import { POST } from "../../app/api/usage/events/batch/route";

function request() {
  return new Request("http://localhost/api/usage/events/batch", {
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify({
      device: {
        id: "device-1",
        name: `Desk\u0000agent${"x".repeat(300)}`
      },
      events: [
        {
          source: `kimicode\u0001${"x".repeat(200)}`,
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
    mocks.authenticateDeviceToken.mockResolvedValue({ id: "token-1", userId: "user-1", deviceId: "device-1" });
    mocks.prisma.device.upsert.mockResolvedValue({ id: "device-1" });
    mocks.prisma.deviceToken.update.mockResolvedValue({});
    mocks.prisma.project.findFirst.mockResolvedValue(null);
    mocks.prisma.project.create.mockResolvedValue({ id: "project-1" });
    mocks.prisma.usageEvent.createMany.mockImplementation(({ data }: { data: unknown[] }) =>
      Promise.resolve({ count: data.length })
    );
    mocks.detectAndTrackUnpricedModels.mockResolvedValue([]);
  });

  it("accepts a poison batch and stores bounded device/source values", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    const deviceWrite = mocks.prisma.device.upsert.mock.calls[0][0];
    const eventRows = mocks.prisma.usageEvent.createMany.mock.calls[0][0].data;
    expect(deviceWrite.update.name).toBe(`Deskagent${"x".repeat(191)}`);
    expect(deviceWrite.update.name).toHaveLength(200);
    expect(eventRows[0].source).toBe(`kimicode${"x".repeat(92)}`);
    expect(eventRows[0].source).toHaveLength(100);
    expect(eventRows[0].source).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
  });
});
