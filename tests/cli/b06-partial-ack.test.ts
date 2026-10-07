import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageEventInput } from "@/shared/usage";

const fixture = vi.hoisted(() => {
  const tmp = (process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp").replace(/[\\/]+$/, "");
  return {
    queuePath: `${tmp}/b06-partial-queue-${process.pid}.jsonl`,
    rejectedUsagePath: `${tmp}/b06-partial-rejected-${process.pid}.jsonl`,
    statePath: `${tmp}/b06-partial-state-${process.pid}.json`,
    fetch: vi.fn()
  };
});

vi.mock("@/cli/config", () => ({
  queuePath: fixture.queuePath,
  rejectedUsagePath: fixture.rejectedUsagePath,
  statePath: fixture.statePath,
  readCredentials: () => ({ deviceToken: "synthetic" }),
  readDevice: () => ({ id: "device-a", name: "Partial ACK" })
}));
vi.mock("@/cli/fetch", () => ({ agentFetch: fixture.fetch }));
vi.mock("@/cli/agent-version", () => ({ getAgentVersion: () => "test" }));

import { writeQueue } from "@/cli/collect";
import { readRejectedUsageEvents } from "@/cli/rejected-events";
import { readQueue, syncEvents } from "@/cli/sync";

const config = { serverUrl: "https://example.test" } as Parameters<typeof syncEvents>[0];
const good = (id: string): UsageEventInput => ({
  source: "aider",
  sourceEventId: id,
  occurredAt: "2026-10-07T12:00:00.000Z",
  inputTokens: 1
});

function success(received: number) {
  return Response.json({ inserted: received, duplicates: 0, received, deviceId: "device-a" });
}

describe("B06 usage partial ACK and quarantine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const path of [fixture.queuePath, fixture.rejectedUsagePath, fixture.statePath]) rmSync(path, { force: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const path of [fixture.queuePath, fixture.rejectedUsagePath, fixture.statePath]) rmSync(path, { force: true });
  });

  it("durably quarantines rejected IDs before checkpointing and keeps all good rows live", async () => {
    const poison = {
      ...good("poison"),
      source: "unknown",
      gitRemote: "https://reader:SECRET@git.example/team/repo.git",
      rawJson: { assistant: "PRIVATE_BODY_CANARY" }
    } as unknown as UsageEventInput;
    const events = [good("good-a"), poison, good("good-b")];
    writeQueue(events);
    fixture.fetch.mockResolvedValueOnce(Response.json({
      inserted: 2,
      duplicates: 0,
      received: 2,
      deviceId: "device-a",
      protocol: "usage-partial-v1",
      accepted: [
        { row: 0, source: "aider", sourceEventId: "good-a" },
        { row: 2, source: "aider", sourceEventId: "good-b" }
      ],
      rejected: [{ row: 1, code: "invalid_event" }]
    }));
    const checkpoints: string[][] = [];

    const result = await syncEvents(config, readQueue(), {
      onBatchSynced: ({ remaining }) => {
        expect(readRejectedUsageEvents()).toHaveLength(1);
        checkpoints.push(remaining.map((row) => row.sourceEventId));
        writeQueue(remaining);
      }
    });

    expect(result).toMatchObject({ inserted: 2, received: 2, rejected: 1 });
    expect(checkpoints).toEqual([[]]);
    expect(readQueue()).toEqual([]);
    const quarantine = readFileSync(fixture.rejectedUsagePath, "utf8");
    expect(quarantine).toContain('"sourceEventId":"poison"');
    expect(quarantine).not.toMatch(/SECRET|PRIVATE_BODY_CANARY/);
    expect(fixture.fetch).toHaveBeenCalledOnce();
    expect(fixture.fetch.mock.calls[0][1].headers["x-tokenizer-batch-protocol"]).toBe("usage-partial-v1");
  });

  it("fails closed on an incomplete or forged ACK partition", async () => {
    const events = [good("good-a"), good("good-b")];
    writeQueue(events);
    fixture.fetch.mockResolvedValueOnce(Response.json({
      inserted: 1,
      duplicates: 0,
      received: 1,
      protocol: "usage-partial-v1",
      accepted: [{ row: 0, source: "aider", sourceEventId: "good-a" }],
      rejected: []
    }));
    const checkpoint = vi.fn();

    await expect(syncEvents(config, readQueue(), { onBatchSynced: checkpoint }))
      .rejects.toThrow("Invalid partial ACK response");
    expect(checkpoint).not.toHaveBeenCalled();
    expect(readQueue().map((row) => row.sourceEventId)).toEqual(["good-a", "good-b"]);
    expect(readRejectedUsageEvents()).toEqual([]);
  });

  it("retains the active queue when durable quarantine is corrupt", async () => {
    const poison = { ...good("poison"), source: "unknown" } as unknown as UsageEventInput;
    writeQueue([poison]);
    writeFileSync(fixture.rejectedUsagePath, "not-json\n");
    fixture.fetch.mockResolvedValueOnce(Response.json({
      inserted: 0,
      duplicates: 0,
      received: 0,
      protocol: "usage-partial-v1",
      accepted: [],
      rejected: [{ row: 0, code: "invalid_event" }]
    }));
    const checkpoint = vi.fn();

    await expect(syncEvents(config, readQueue(), { onBatchSynced: checkpoint })).rejects.toThrow();
    expect(checkpoint).not.toHaveBeenCalled();
    expect(readQueue()[0].sourceEventId).toBe("poison");
    expect(readFileSync(fixture.rejectedUsagePath, "utf8")).toBe("not-json\n");
  });

  it("recovers after queue checkpoint failure without losing or duplicating quarantine rows", async () => {
    const poison = { ...good("poison"), source: "unknown" } as unknown as UsageEventInput;
    writeQueue([good("good"), poison]);
    const partial = () => Response.json({
      inserted: 1,
      duplicates: 0,
      received: 1,
      protocol: "usage-partial-v1",
      accepted: [{ row: 0, source: "aider", sourceEventId: "good" }],
      rejected: [{ row: 1, code: "invalid_event" }]
    });
    fixture.fetch.mockResolvedValueOnce(partial());

    await expect(syncEvents(config, readQueue(), {
      onBatchSynced: () => { throw new Error("checkpoint disk full"); }
    })).rejects.toThrow("checkpoint disk full");
    expect(readQueue()).toHaveLength(2);
    expect(readRejectedUsageEvents()).toHaveLength(1);

    fixture.fetch.mockResolvedValueOnce(partial());
    await syncEvents(config, readQueue(), { onBatchSynced: ({ remaining }) => writeQueue(remaining) });
    expect(readQueue()).toEqual([]);
    expect(readRejectedUsageEvents()).toHaveLength(1);
  });

  it("supports the prior whole-batch B06 server without retrying a permanent 400", async () => {
    const poison = { ...good("poison"), source: "unknown" } as unknown as UsageEventInput;
    writeQueue([good("good"), poison]);
    fixture.fetch
      .mockResolvedValueOnce(Response.json(
        { error: "invalid batch request", code: "invalid_event", row: 1 },
        { status: 400 }
      ))
      .mockResolvedValueOnce(success(1));
    const checkpoints: string[][] = [];

    const result = await syncEvents(config, readQueue(), {
      onBatchSynced: ({ remaining }) => {
        checkpoints.push(remaining.map((row) => row.sourceEventId));
        writeQueue(remaining);
      }
    });

    expect(result).toMatchObject({ inserted: 1, received: 1, rejected: 1 });
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
    expect(checkpoints).toEqual([["good"], []]);
    expect(readQueue()).toEqual([]);
    expect(readRejectedUsageEvents()[0].event.sourceEventId).toBe("poison");
  });

  it("does not retry permanent auth failures or expose response bodies", async () => {
    const canary = "SERVER_PRIVATE_CANARY";
    writeQueue([good("good")]);
    fixture.fetch.mockResolvedValueOnce(Response.json({ error: canary }, { status: 401 }));

    const error = await syncEvents(config, readQueue()).then(
      () => { throw new Error("expected rejection"); },
      (caught: Error) => caught
    );

    expect(error.message).toBe("Sync failed: 401");
    expect(error.message).not.toContain(canary);
    expect(fixture.fetch).toHaveBeenCalledOnce();
    expect(readQueue()).toHaveLength(1);
  });

  it("keeps bounded retry for 429 and 5xx responses", async () => {
    vi.useFakeTimers();
    fixture.fetch
      .mockResolvedValueOnce(Response.json({ error: "busy" }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ error: "down" }, { status: 503 }))
      .mockResolvedValueOnce(success(1));

    const pending = syncEvents(config, [good("good")]);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toMatchObject({ received: 1 });
    expect(fixture.fetch).toHaveBeenCalledTimes(3);
  });
});
