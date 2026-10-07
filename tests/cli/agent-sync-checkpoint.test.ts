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
  readDevice: () => ({ id: "dev-1", name: "Test Device" }),
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
  mergeQueueEvents: mocks.writeQueue
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
    mocks.writeQueue.mockImplementation((events: UsageEventInput[]) => events);
    mocks.dedupeBySourceEventId.mockImplementation((events: UsageEventInput[]) => events);
  });

  it("keeps local-only events queued without heartbeat, usage sync, quota, or harness traffic", async () => {
    mocks.readConfig.mockReturnValue({ serverUrl: "https://example.test", privacy: { mode: "local-only", includePaths: [], excludePaths: [] } });
    const cursor = { files: {}, opencodeLastTimeCreated: 0, claudeParserVersion: 2 };
    const local = event("local", "2026-08-22T15:00:00.000Z");
    mocks.readCursor.mockReturnValue(cursor);
    mocks.collectEvents.mockReturnValue({ events: [local], warnings: [] });

    const result = await runOnce();

    expect(result.received).toBe(0);
    expect(mocks.writeQueue).toHaveBeenCalledWith([local]);
    expect(mocks.writeCursor).toHaveBeenCalledWith(cursor);
    expect(mocks.heartbeat).not.toHaveBeenCalled();
    expect(mocks.syncEvents).not.toHaveBeenCalled();
    expect(mocks.runQuotaRefresh).not.toHaveBeenCalled();
    expect(mocks.runHarnessSync).not.toHaveBeenCalled();
  });

  it("pauses collection before touching cursors or network", async () => {
    mocks.readConfig.mockReturnValue({ serverUrl: "https://example.test", privacy: { mode: "paused", includePaths: [], excludePaths: [] } });
    const result = await runOnce();
    expect(result.received).toBe(0);
    expect(mocks.readCursor).not.toHaveBeenCalled();
    expect(mocks.collectEvents).not.toHaveBeenCalled();
    expect(mocks.heartbeat).not.toHaveBeenCalled();
    expect(mocks.syncEvents).not.toHaveBeenCalled();
  });

  it("retains previously admitted local-only backlog after path rules change", async () => {
    mocks.readConfig.mockReturnValue({
      serverUrl: "https://example.test",
      privacy: { mode: "local-only", includePaths: ["/work/new"], excludePaths: ["/work/old"] }
    });
    const backlog = { ...event("admitted-before-change", "2026-08-21T15:00:00.000Z"), workspacePath: "/work/old" };
    const fresh = { ...event("fresh", "2026-08-22T15:00:00.000Z"), workspacePath: "/work/new" };
    mocks.readCursor.mockReturnValue({ files: {}, opencodeLastTimeCreated: 0, claudeParserVersion: 2 });
    mocks.readQueue.mockReturnValue([backlog]);
    mocks.collectEvents.mockReturnValue({ events: [fresh], warnings: [] });

    await runOnce();

    expect(mocks.writeQueue).toHaveBeenCalledWith([backlog, fresh]);
    expect(mocks.syncEvents).not.toHaveBeenCalled();
  });

  it("uploads admitted backlog on the next sync-mode agent cycle despite new path rules", async () => {
    const config = {
      serverUrl: "https://example.test",
      privacy: { mode: "sync", includePaths: ["/work/new"], excludePaths: ["/work/old"] }
    };
    const backlog = { ...event("local-only-backlog", "2026-08-21T15:00:00.000Z"), workspacePath: "/work/old" };
    mocks.readConfig.mockReturnValue(config);
    mocks.readCursor.mockReturnValue({ files: {}, opencodeLastTimeCreated: 0, claudeParserVersion: 2 });
    mocks.readQueue.mockReturnValue([backlog]);
    mocks.collectEvents.mockReturnValue({ events: [], warnings: [] });
    mocks.syncEvents.mockResolvedValue({ inserted: 1, duplicates: 0, received: 1 });

    await runOnce();

    expect(mocks.syncEvents).toHaveBeenCalledWith(config, [backlog]);
    expect(mocks.clearQueue).not.toHaveBeenCalled();
  });

  it("persists the cursor after queueing and delegates exact durable ACKs to syncEvents", async () => {
    const newest = event("newest", "2026-08-22T15:00:00.000Z");
    const older = event("older", "2026-08-22T14:00:00.000Z");
    const cursor = { files: { log: { mtimeMs: 1, size: 2 } }, opencodeLastTimeCreated: 0, claudeParserVersion: 2 };
    mocks.readCursor.mockReturnValue(cursor);
    mocks.collectEvents.mockReturnValue({ events: [newest, older], warnings: [] });
    mocks.syncEvents.mockRejectedValue(new Error("network timeout"));

    await expect(runOnce()).rejects.toThrow("network timeout");

    expect(mocks.writeQueue).toHaveBeenNthCalledWith(1, [newest, older]);
    expect(mocks.writeCursor).toHaveBeenCalledWith(cursor);
    expect(mocks.writeCursor.mock.invocationCallOrder[0]).toBeLessThan(mocks.syncEvents.mock.invocationCallOrder[0]);
    expect(mocks.writeQueue).toHaveBeenCalledTimes(1);
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

  it("does not perform a stale whole-file callback write after sync succeeds", async () => {
    const newest = event("newest", "2026-08-22T15:00:00.000Z");
    const older = event("older", "2026-08-22T14:00:00.000Z");
    const cursor = { files: {}, opencodeLastTimeCreated: 0, claudeParserVersion: 2 };
    mocks.readCursor.mockReturnValue(cursor);
    mocks.collectEvents.mockReturnValue({ events: [newest, older], warnings: [] });
    mocks.syncEvents.mockResolvedValue({ inserted: 2, duplicates: 0, received: 2 });

    await expect(runOnce()).resolves.toMatchObject({ received: 2 });

    expect(mocks.writeQueue).toHaveBeenNthCalledWith(1, [newest, older]);
    expect(mocks.writeQueue).toHaveBeenCalledTimes(1);
    expect(mocks.syncEvents).toHaveBeenCalledWith(expect.anything(), [newest, older]);
    expect(mocks.clearQueue).not.toHaveBeenCalled();
    expect(mocks.updateState).toHaveBeenCalledWith(expect.objectContaining({ lastSyncStatus: "success" }));
  });
});
