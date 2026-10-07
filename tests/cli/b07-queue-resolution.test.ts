import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageEventInput } from "@/shared/usage";

const fixture = vi.hoisted(() => {
  const tmp = (process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp").replace(/[\\/]+$/, "");
  return {
    queuePath: `${tmp}/b07-resolution-queue-${process.pid}.jsonl`,
    rejectedUsagePath: `${tmp}/b07-resolution-rejected-${process.pid}.jsonl`,
    statePath: `${tmp}/b07-resolution-state-${process.pid}.json`,
    fetch: vi.fn()
  };
});

vi.mock("@/cli/config", () => ({
  queuePath: fixture.queuePath,
  rejectedUsagePath: fixture.rejectedUsagePath,
  statePath: fixture.statePath,
  readCredentials: () => ({ deviceToken: "synthetic" }),
  readDevice: () => ({ id: "device-b07", name: "B07" })
}));
vi.mock("@/cli/fetch", () => ({ agentFetch: fixture.fetch }));
vi.mock("@/cli/agent-version", () => ({ getAgentVersion: () => "test" }));

import { queueEventVersion, resolveQueueEvents, writeQueue } from "@/cli/collect";
import { readRejectedUsageEvents } from "@/cli/rejected-events";
import { readQueue, syncEvents } from "@/cli/sync";

const config = { serverUrl: "https://example.test" } as Parameters<typeof syncEvents>[0];
function event(id: string, inputTokens = 1): UsageEventInput {
  return { source: "aider", sourceEventId: id, occurredAt: "2026-10-08T00:00:00.000Z", inputTokens };
}
function legacySuccess(received: number) {
  return Response.json({ inserted: received, duplicates: 0, received, deviceId: "device-b07" });
}

describe("B07 exact-version durable queue resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const path of [fixture.queuePath, fixture.rejectedUsagePath, fixture.statePath]) rmSync(path, { force: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    for (const path of [fixture.queuePath, fixture.rejectedUsagePath, fixture.statePath]) rmSync(path, { force: true });
  });

  it("partial ACK removes only exact versions and preserves a concurrent correction", async () => {
    const old = event("same-id", 1);
    const poison = { ...event("poison"), source: "unknown" } as unknown as UsageEventInput;
    writeQueue([old, poison]);
    fixture.fetch.mockImplementationOnce(async () => {
      writeQueue([event("same-id", 2), event("newly-collected")]);
      return Response.json({
        inserted: 1, duplicates: 0, received: 1, protocol: "usage-partial-v1",
        accepted: [{ row: 0, source: "aider", sourceEventId: "same-id" }],
        rejected: [{ row: 1, code: "invalid_event" }]
      });
    });

    await expect(syncEvents(config, [old, poison])).resolves.toMatchObject({ received: 1, rejected: 1 });
    const remaining = readQueue();
    expect(remaining.map(queueEventVersion)).toEqual([
      queueEventVersion(event("same-id", 2)),
      queueEventVersion(event("newly-collected"))
    ]);
    expect(readRejectedUsageEvents().map((row) => row.event.sourceEventId)).toEqual(["poison"]);
  });

  it("fails closed on an incomplete or forged partial ACK", async () => {
    const events = [event("a"), event("b")];
    writeQueue(events);
    fixture.fetch.mockResolvedValueOnce(Response.json({
      inserted: 1, duplicates: 0, received: 1, protocol: "usage-partial-v1",
      accepted: [{ row: 0, source: "aider", sourceEventId: "forged" }], rejected: []
    }));
    await expect(syncEvents(config, events)).rejects.toThrow("Invalid partial ACK response");
    expect(readQueue().map(queueEventVersion)).toEqual(events.map(queueEventVersion));
  });

  it("retains the active queue when durable quarantine is corrupt", async () => {
    const poison = { ...event("poison"), source: "unknown" } as unknown as UsageEventInput;
    writeQueue([poison]);
    writeFileSync(fixture.rejectedUsagePath, "not-json\n");
    fixture.fetch.mockResolvedValueOnce(Response.json({
      inserted: 0, duplicates: 0, received: 0, protocol: "usage-partial-v1",
      accepted: [], rejected: [{ row: 0, code: "invalid_event" }]
    }));
    await expect(syncEvents(config, [poison])).rejects.toThrow();
    expect(readQueue().map(queueEventVersion)).toEqual([queueEventVersion(poison)]);
    expect(readFileSync(fixture.rejectedUsagePath, "utf8")).toBe("not-json\n");
  });

  it("supports a row-addressed previous-server rejection without retrying poison", async () => {
    const good = event("good");
    const poison = { ...event("poison"), source: "unknown" } as unknown as UsageEventInput;
    writeQueue([good, poison]);
    fixture.fetch
      .mockResolvedValueOnce(Response.json({ code: "invalid_event", row: 1 }, { status: 400 }))
      .mockResolvedValueOnce(legacySuccess(1));
    await expect(syncEvents(config, [good, poison])).resolves.toMatchObject({ received: 1, rejected: 1 });
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
    expect(readQueue()).toEqual([]);
  });

  it("isolates rowless previous-server invalid_json with bounded binary narrowing", async () => {
    const goodA = event("good-a");
    const poison = { ...event("poison"), workspacePath: "\ud800" };
    const goodB = event("good-b");
    writeQueue([goodA, poison, goodB]);
    fixture.fetch.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { events: UsageEventInput[] };
      if (body.events.some((row) => row.sourceEventId === "poison")) {
        return Response.json({ code: "invalid_json" }, { status: 400 });
      }
      return legacySuccess(body.events.length);
    });
    await expect(syncEvents(config, [goodA, poison, goodB])).resolves.toMatchObject({ received: 2, rejected: 1 });
    expect(fixture.fetch).toHaveBeenCalledTimes(7);
    expect(readQueue()).toEqual([]);
    expect(readRejectedUsageEvents()[0]).toMatchObject({ code: "invalid_json", event: { sourceEventId: "poison" } });
  });

  it("fails closed on a global rowless invalid_json when the empty probe also fails", async () => {
    const active = event("active");
    writeQueue([active]);
    fixture.fetch.mockResolvedValue(Response.json({ code: "invalid_json" }, { status: 400 }));
    await expect(syncEvents(config, [active])).rejects.toThrow("Sync failed: 400 invalid_json");
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
    expect(readQueue().map(queueEventVersion)).toEqual([queueEventVersion(active)]);
    expect(readRejectedUsageEvents()).toEqual([]);
  });

  it("does not retry a permanent auth failure or expose its body", async () => {
    const active = event("active");
    writeQueue([active]);
    fixture.fetch.mockResolvedValueOnce(Response.json({ error: "PRIVATE_CANARY" }, { status: 401 }));
    await expect(syncEvents(config, [active])).rejects.toThrow("Sync failed: 401");
    expect(fixture.fetch).toHaveBeenCalledOnce();
    expect(readQueue().map(queueEventVersion)).toEqual([queueEventVersion(active)]);
  });

  it("keeps bounded transient retry and exact-ACKs after recovery", async () => {
    vi.useFakeTimers();
    const active = event("active");
    writeQueue([active]);
    fixture.fetch
      .mockResolvedValueOnce(Response.json({ error: "busy" }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ error: "down" }, { status: 503 }))
      .mockResolvedValueOnce(legacySuccess(1));
    const pending = syncEvents(config, [active]);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ received: 1 });
    expect(fixture.fetch).toHaveBeenCalledTimes(3);
    expect(readQueue()).toEqual([]);
  });

  it("quarantines before deleting so a quarantine failure cannot lose poison", () => {
    const poison = { ...event("poison"), source: "unknown" } as unknown as UsageEventInput;
    writeQueue([poison]);
    writeFileSync(fixture.rejectedUsagePath, "not-json\n");
    expect(() => resolveQueueEvents({ accepted: [], rejected: [{ event: poison, code: "invalid_event" }] })).toThrow();
    expect(readQueue().map(queueEventVersion)).toEqual([queueEventVersion(poison)]);
  });
});
