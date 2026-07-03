import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceInput, UsageEventInput } from "@/shared/usage";

const prismaMock = vi.hoisted(() => ({
  device: { upsert: vi.fn() },
  deviceToken: { update: vi.fn() },
  project: { upsert: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  usageEvent: { createMany: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  $transaction: vi.fn()
}));

vi.mock("@/server/db", () => ({ prisma: prismaMock }));

import { ingestUsageEvents } from "@/server/ingest";

function event(overrides: Partial<UsageEventInput> = {}): UsageEventInput {
  return {
    source: "claude-code",
    sourceEventId: "evt-1",
    occurredAt: "2026-07-02T00:00:00.000Z",
    inputTokens: 10,
    outputTokens: 5,
    ...overrides
  };
}

// The comparable projection of an existing DB row, mirroring what the
// correction pass selects.
function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    source: "claude-code",
    sourceEventId: "evt-1",
    model: null,
    inputTokens: 10,
    outputTokens: 5,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    reasoningOutputTokens: 0,
    cacheEphemeral5mInputTokens: 0,
    cacheEphemeral1hInputTokens: 0,
    webSearchRequests: 0,
    webFetchRequests: 0,
    serviceTier: null,
    totalTokens: 15,
    fallbackFromModel: null,
    fallbackToModel: null,
    ...overrides
  };
}

// Correction requires a v2+ agent: older agents keep uploading first-row
// placeholder snapshots and must not be able to regress corrected rows.
const device: DeviceInput = {
  id: "dev-1",
  name: "Test Device",
  diagnostics: { agentFeatureVersion: 2 }
};

describe("ingestUsageEvents conflict correction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.device.upsert.mockResolvedValue({ id: device.id });
    prismaMock.deviceToken.update.mockResolvedValue({});
    prismaMock.project.findFirst.mockResolvedValue(null);
    prismaMock.project.create.mockResolvedValue({ id: "proj-x" });
    prismaMock.usageEvent.update.mockResolvedValue({});
    prismaMock.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));
  });

  it("passes fallback fields through to created rows", async () => {
    prismaMock.usageEvent.createMany.mockResolvedValue({ count: 2 });

    await ingestUsageEvents(
      [
        event({
          sourceEventId: "evt-final",
          model: "claude-opus-4-8",
          fallbackFromModel: "claude-fable-5"
        }),
        event({
          sourceEventId: "evt-final:iter0",
          model: "claude-fable-5",
          fallbackToModel: "claude-opus-4-8"
        })
      ],
      device,
      "tok-1",
      "user-1"
    );

    const rows = prismaMock.usageEvent.createMany.mock.calls[0][0].data;
    expect(rows[0].fallbackFromModel).toBe("claude-fable-5");
    expect(rows[0].fallbackToModel).toBeNull();
    expect(rows[1].fallbackToModel).toBe("claude-opus-4-8");
  });

  it("does not touch existing rows when every event inserted", async () => {
    prismaMock.usageEvent.createMany.mockResolvedValue({ count: 1 });

    const result = await ingestUsageEvents([event()], device, "tok-1", "user-1");

    expect(result).toMatchObject({ inserted: 1, updated: 0, duplicates: 0, received: 1 });
    expect(prismaMock.usageEvent.findMany).not.toHaveBeenCalled();
    expect(prismaMock.usageEvent.update).not.toHaveBeenCalled();
  });

  it("leaves identical duplicate rows untouched", async () => {
    prismaMock.usageEvent.createMany.mockResolvedValue({ count: 0 });
    prismaMock.usageEvent.findMany.mockResolvedValue([dbRow()]);

    const result = await ingestUsageEvents([event()], device, "tok-1", "user-1");

    expect(result).toMatchObject({ inserted: 0, updated: 0, duplicates: 1, received: 1 });
    expect(prismaMock.usageEvent.update).not.toHaveBeenCalled();
  });

  it("corrects a stale row in place when the re-parsed event differs", async () => {
    // The partial-parse race: the first sync uploaded the placeholder
    // snapshot (fable-5, output 8); the full sequence later resolves to
    // opus-4-8 with the real bill. Same sourceEventId, so the correction
    // pass must update the existing row rather than drop the new data.
    prismaMock.usageEvent.createMany.mockResolvedValue({ count: 0 });
    prismaMock.usageEvent.findMany.mockResolvedValue([
      dbRow({ model: "claude-fable-5", inputTokens: 71133, outputTokens: 8, totalTokens: 71141 })
    ]);

    const result = await ingestUsageEvents(
      [
        event({
          model: "claude-opus-4-8",
          inputTokens: 69461,
          outputTokens: 767,
          totalTokens: 70228,
          fallbackFromModel: "claude-fable-5"
        })
      ],
      device,
      "tok-1",
      "user-1"
    );

    expect(result).toMatchObject({ inserted: 0, updated: 1, duplicates: 0, received: 1 });
    expect(prismaMock.usageEvent.update).toHaveBeenCalledTimes(1);
    const call = prismaMock.usageEvent.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "row-1" });
    expect(call.data.model).toBe("claude-opus-4-8");
    expect(call.data.outputTokens).toBe(767);
    expect(call.data.totalTokens).toBe(70228);
    expect(call.data.fallbackFromModel).toBe("claude-fable-5");
  });

  it("never corrects rows for agents below the parser-v2 feature version", async () => {
    // A v1 agent re-parsing a grown file re-uploads the stale first-row
    // snapshot under the same sourceEventId. Applying that as a "correction"
    // would regress rows a v2 agent already fixed, so the correction pass is
    // gated on the uploading agent's feature version.
    prismaMock.usageEvent.createMany.mockResolvedValue({ count: 0 });

    const legacyDevice: DeviceInput = { id: "dev-1", name: "Test Device" };
    const result = await ingestUsageEvents(
      [event({ model: "claude-fable-5", outputTokens: 8 })],
      legacyDevice,
      "tok-1",
      "user-1"
    );

    expect(result).toMatchObject({ inserted: 0, updated: 0, duplicates: 1, received: 1 });
    expect(prismaMock.usageEvent.findMany).not.toHaveBeenCalled();
    expect(prismaMock.usageEvent.update).not.toHaveBeenCalled();
  });

  it("only queries existing rows for the conflicted batch keys", async () => {
    prismaMock.usageEvent.createMany.mockResolvedValue({ count: 1 });
    prismaMock.usageEvent.findMany.mockResolvedValue([dbRow({ sourceEventId: "evt-a" })]);

    await ingestUsageEvents(
      [event({ sourceEventId: "evt-a" }), event({ sourceEventId: "evt-b" })],
      device,
      "tok-1",
      "user-1"
    );

    expect(prismaMock.usageEvent.findMany).toHaveBeenCalledTimes(1);
    const where = prismaMock.usageEvent.findMany.mock.calls[0][0].where;
    expect(where.deviceId).toBe("dev-1");
    expect(where.sourceEventId.in).toEqual(["evt-a", "evt-b"]);
  });
});
