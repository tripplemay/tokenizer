import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageEventInput } from "@/shared/usage";

const mocks = vi.hoisted(() => ({
  heartbeat: vi.fn(),
  readConfig: vi.fn(),
  readCursor: vi.fn(),
  writeCursor: vi.fn(),
  collectEvents: vi.fn(),
  readQueue: vi.fn(),
  dedupeBySourceEventId: vi.fn(),
  writeQueue: vi.fn(),
  syncEvents: vi.fn(),
  clearQueue: vi.fn(),
  updateState: vi.fn(),
  runQuotaRefresh: vi.fn(),
  runHarnessSync: vi.fn(),
  acquireAgentLock: vi.fn()
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, mkdirSync: vi.fn(), appendFileSync: vi.fn() };
});
vi.mock("@/cli/sync", () => ({
  heartbeat: mocks.heartbeat,
  readQueue: mocks.readQueue,
  syncEvents: mocks.syncEvents,
  clearQueue: mocks.clearQueue
}));
vi.mock("@/cli/config", () => ({
  readConfig: mocks.readConfig,
  readState: vi.fn(() => ({})),
  updateState: mocks.updateState
}));
vi.mock("@/cli/cursor", () => ({
  readCursor: mocks.readCursor,
  writeCursor: mocks.writeCursor
}));
vi.mock("@/cli/collect", () => ({
  collectEvents: mocks.collectEvents,
  dedupeBySourceEventId: mocks.dedupeBySourceEventId,
  writeQueue: mocks.writeQueue
}));
vi.mock("@/quota/run", () => ({ runQuotaRefresh: mocks.runQuotaRefresh }));
vi.mock("@/cli/harness", () => ({ runHarnessSync: mocks.runHarnessSync }));
vi.mock("@/cli/agent-lock", () => ({ acquireAgentLock: mocks.acquireAgentLock }));

import { runOnce } from "@/cli/agent";

function event(id: string, occurredAt: string): UsageEventInput {
  return {
    source: "codex",
    sourceEventId: id,
    occurredAt,
    inputTokens: 1,
    outputTokens: 1
  };
}

describe("runOnce durable sync checkpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.writeQueue.mockReset();
    mocks.writeCursor.mockReset();
    mocks.syncEvents.mockReset();
    mocks.readConfig.mockReturnValue({ serverUrl: "https://example.test" });
    mocks.heartbeat.mockResolvedValue({ ok: true });
    mocks.readQueue.mockReturnValue([]);
    mocks.dedupeBySourceEventId.mockImplementation((events: UsageEventInput[]) => events);
  });

  it("persists the cursor after queueing and retains only the unsent tail on failure", async () => {
    const newest = event("newest", "2026-08-22T15:00:00.000Z");
    const older = event("older", "2026-08-22T14:00:00.000Z");
    const cursor = { files: { log: { mtimeMs: 1, size: 2 } }, opencodeLastTimeCreated: 0, claudeParserVersion: 2 };
    mocks.readCursor.mockReturnValue(cursor);
    mocks.collectEvents.mockReturnValue({ events: [newest, older], warnings: [] });
    mocks.syncEvents.mockImplementation(async (_config, events, options) => {
      await options.onBatchSynced({ synced: 1, total: 2, remaining: [events[1]] });
      throw new Error("network timeout");
    });

    await expect(runOnce()).rejects.toThrow("network timeout");

    expect(mocks.writeQueue).toHaveBeenNthCalledWith(1, [newest, older]);
    expect(mocks.writeCursor).toHaveBeenCalledWith(cursor);
    expect(mocks.writeCursor.mock.invocationCallOrder[0]).toBeLessThan(mocks.syncEvents.mock.invocationCallOrder[0]);
    expect(mocks.writeQueue).toHaveBeenNthCalledWith(2, [older]);
    expect(mocks.clearQueue).not.toHaveBeenCalled();
    expect(mocks.updateState).toHaveBeenCalledWith(expect.objectContaining({
      lastSyncStatus: "failed",
      lastError: "network timeout"
    }));
  });

  it("does not advance the cursor or upload when the durable queue write fails", async () => {
    const cursor = { files: {}, opencodeLastTimeCreated: 0, claudeParserVersion: 2 };
    mocks.readCursor.mockReturnValue(cursor);
    mocks.collectEvents.mockReturnValue({ events: [event("new", "2026-08-22T15:00:00.000Z")], warnings: [] });
    mocks.writeQueue.mockImplementationOnce(() => {
      throw new Error("queue disk full");
    });

    await expect(runOnce()).rejects.toThrow("queue disk full");

    expect(mocks.writeCursor).not.toHaveBeenCalled();
    expect(mocks.syncEvents).not.toHaveBeenCalled();
    expect(mocks.clearQueue).not.toHaveBeenCalled();
  });

  it("keeps the queued events and does not upload when the cursor write fails", async () => {
    const queuedEvent = event("queued", "2026-08-22T15:00:00.000Z");
    const cursor = { files: {}, opencodeLastTimeCreated: 0, claudeParserVersion: 2 };
    mocks.readCursor.mockReturnValue(cursor);
    mocks.collectEvents.mockReturnValue({ events: [queuedEvent], warnings: [] });
    mocks.writeCursor.mockImplementationOnce(() => {
      throw new Error("cursor disk full");
    });

    await expect(runOnce()).rejects.toThrow("cursor disk full");

    expect(mocks.writeQueue).toHaveBeenCalledOnce();
    expect(mocks.writeQueue).toHaveBeenCalledWith([queuedEvent]);
    expect(mocks.syncEvents).not.toHaveBeenCalled();
    expect(mocks.clearQueue).not.toHaveBeenCalled();
  });

  it("does not clear the queue when a per-batch remaining checkpoint fails", async () => {
    const newest = event("newest", "2026-08-22T15:00:00.000Z");
    const older = event("older", "2026-08-22T14:00:00.000Z");
    const cursor = { files: {}, opencodeLastTimeCreated: 0, claudeParserVersion: 2 };
    mocks.readCursor.mockReturnValue(cursor);
    mocks.collectEvents.mockReturnValue({ events: [newest, older], warnings: [] });
    mocks.writeQueue
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error("checkpoint disk full");
      });
    mocks.syncEvents.mockImplementation(async (_config, events, options) => {
      await options.onBatchSynced({ synced: 1, total: 2, remaining: [events[1]] });
      return { inserted: 2, duplicates: 0, received: 2 };
    });

    await expect(runOnce()).rejects.toThrow("checkpoint disk full");

    expect(mocks.writeQueue).toHaveBeenNthCalledWith(1, [newest, older]);
    expect(mocks.writeQueue).toHaveBeenNthCalledWith(2, [older]);
    expect(mocks.clearQueue).not.toHaveBeenCalled();
    expect(mocks.updateState).toHaveBeenCalledWith(expect.objectContaining({
      lastSyncStatus: "failed",
      lastError: "checkpoint disk full"
    }));
  });
});
