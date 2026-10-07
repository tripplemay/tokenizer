import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), timezone: vi.fn(), cache: vi.fn(), price: vi.fn(), detect: vi.fn(),
  prisma: {
    device: { upsert: vi.fn() }, deviceToken: { update: vi.fn() },
    project: { findFirst: vi.fn(), create: vi.fn() },
    usageEvent: { createMany: vi.fn() }
  }
}));
vi.mock("@/server/auth", () => ({
  authenticateDeviceToken: mocks.auth,
  unauthorized: () => Response.json({ error: "unauthorized" }, { status: 401 }),
  forbidden: () => Response.json({ error: "forbidden" }, { status: 403 })
}));
vi.mock("@/server/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/server/timezone", () => ({ updateUserTimezoneIfValid: mocks.timezone }));
vi.mock("@/server/usage-cost-cache", () => ({ invalidateUsageCostCache: mocks.cache }));
vi.mock("@/server/pricing/trigger", () => ({ maybeTriggerPriceLookup: mocks.price }));
vi.mock("@/server/pricing/detect", () => ({ detectAndTrackUnpricedModels: mocks.detect }));

import { POST } from "../../app/api/usage/events/batch/route";

const token = { id: "token-a", userId: "tenant-a", deviceId: "device-a", device: { id: "device-a", userId: "tenant-a" } };
const event = (id: string) => ({ source: "aider", sourceEventId: id, occurredAt: "2026-10-07T12:00:00.000Z", inputTokens: 2 });
const body = (events: unknown[]) => ({ device: { id: "device-a", name: "Agent" }, timezone: "UTC", events });
function request(payload: unknown, partial = false) {
  return new Request("http://localhost/batch", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(partial ? { "x-tokenizer-batch-protocol": "usage-partial-v1" } : {})
    },
    body: JSON.stringify(payload)
  }) as never;
}
function noWrites() {
  for (const fn of [mocks.timezone, mocks.cache, mocks.price, mocks.detect, mocks.prisma.device.upsert, mocks.prisma.deviceToken.update, mocks.prisma.project.findFirst, mocks.prisma.project.create, mocks.prisma.usageEvent.createMany]) {
    expect(fn).not.toHaveBeenCalled();
  }
}

describe("B06 opt-in usage partial ACK protocol", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(token);
    mocks.prisma.device.upsert.mockResolvedValue({ id: "device-a" });
    mocks.prisma.project.findFirst.mockResolvedValue(null);
    mocks.prisma.project.create.mockResolvedValue({ id: "project-a" });
    mocks.prisma.usageEvent.createMany.mockImplementation(({ data }) => Promise.resolve({ count: data.length }));
    mocks.detect.mockResolvedValue([]);
  });

  it("ACKs valid IDs and rejects poison rows while writing only the valid subset", async () => {
    const response = await POST(request(body([
      event("good-a"),
      { ...event("poison-source"), source: "unknown" },
      { ...event("poison-count"), inputTokens: -1 },
      event("good-b")
    ]), true));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      inserted: 2,
      received: 2,
      protocol: "usage-partial-v1",
      accepted: [
        { row: 0, source: "aider", sourceEventId: "good-a" },
        { row: 3, source: "aider", sourceEventId: "good-b" }
      ],
      rejected: [
        { row: 1, code: "invalid_event" },
        { row: 2, code: "invalid_event" }
      ]
    });
    const rows = mocks.prisma.usageEvent.createMany.mock.calls[0][0].data;
    expect(rows.map((row) => row.sourceEventId)).toEqual(["good-a", "good-b"]);
  });

  it("keeps the old Agent whole-batch 400 contract unchanged", async () => {
    const response = await POST(request(body([event("good"), { ...event("poison"), source: "unknown" }])));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid batch request", code: "invalid_event", row: 1 });
    noWrites();
  });

  it("does not mutate device, token or timezone when every row is rejected", async () => {
    const response = await POST(request(body([{ ...event("poison"), inputTokens: -1 }]), true));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      inserted: 0,
      received: 0,
      accepted: [],
      rejected: [{ row: 0, code: "invalid_event" }]
    });
    noWrites();
  });

  it("localizes invalid JSON structure only for the opt-in protocol", async () => {
    const payload = body([event("good"), { ...event("poison"), model: "\ud800" }]);
    const partial = await POST(request(payload, true));
    expect(partial.status).toBe(400);
    expect(await partial.json()).toEqual({ error: "invalid batch request", code: "invalid_json", row: 1 });
    noWrites();

    const legacy = await POST(request(payload));
    expect(legacy.status).toBe(400);
    expect(await legacy.json()).toEqual({ error: "invalid batch request", code: "invalid_json" });
    noWrites();
  });
});
