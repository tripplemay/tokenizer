import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UsageEventInput } from "@/shared/usage";

const fetchMock = vi.hoisted(() => vi.fn());
// Windows has no "/tmp"; a hardcoded POSIX path would resolve to the current
// drive root and fail. Read the env directly — vi.hoisted runs before imports,
// so node:os isn't available here.
const tmp = vi.hoisted(() => {
  const dir = (process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp").replace(/[\\/]+$/, "");
  return {
    queuePath: `${dir}/tokenizer-test-queue.jsonl`,
    statePath: `${dir}/tokenizer-test-state.json`
  };
});
vi.mock("@/cli/fetch", () => ({ agentFetch: fetchMock }));
vi.mock("@/cli/config", () => ({
  queuePath: tmp.queuePath,
  statePath: tmp.statePath,
  readCredentials: () => ({ deviceToken: "tok" }),
  readDevice: () => ({ id: "dev-1", name: "Test Device" })
}));
vi.mock("@/cli/agent-version", () => ({ getAgentVersion: () => "test" }));

import { readDiagnostics, readQueue, syncEvents } from "@/cli/sync";
import { writeQueue } from "@/cli/collect";
import { parseClaudeUsage } from "@/parsers/claude";

const config = { serverUrl: "https://example.test" } as Parameters<typeof syncEvents>[0];

function event(id: number): UsageEventInput {
  return {
    source: "claude-code",
    sourceEventId: `evt-${id}`,
    occurredAt: "2026-07-03T00:00:00.000Z",
    inputTokens: 1,
    outputTokens: 1
  };
}

function okResponse(inserted: number) {
  return {
    ok: true,
    json: () => Promise.resolve({ inserted, duplicates: 0, received: inserted, deviceId: "dev-1" })
  };
}

describe("syncEvents batch retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    rmSync(tmp.queuePath, { force: true });
  });

  afterEach(() => {
    rmSync(tmp.queuePath, { force: true });
    vi.useRealTimers();
  });

  it("keeps a source content canary out of the queue and HTTP body", async () => {
    const canary = "PRIVATE_BODY_TOOL_URL_TOKEN_CANARY";
    const homeDir = mkdtempSync(join(tmpdir(), "tokenizer-private-source-"));
    try {
      const dir = join(homeDir, ".claude", "projects", "proj");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "session.jsonl"), JSON.stringify({
        type: "assistant",
        uuid: "uuid-1",
        cwd: "/tmp/proj",
        timestamp: "2026-01-01T00:00:00.000Z",
        sessionId: "sess-1",
        message: {
          role: "assistant",
          id: "msg-1",
          model: "claude-3-5-sonnet",
          usage: { input_tokens: 10, output_tokens: 5 },
          content: [{ type: "text", text: canary }, { type: "tool_use", input: { content: canary } }]
        }
      }) + "\n");
      const sourceEvents = parseClaudeUsage({ homeDir, projectRoots: [] }).events;
      expect(sourceEvents).toHaveLength(1);
      expect(JSON.stringify(sourceEvents)).not.toContain(canary);
      writeQueue(sourceEvents);
      expect(readFileSync(tmp.queuePath, "utf8")).not.toContain(canary);
      fetchMock.mockResolvedValueOnce(okResponse(1));
      await syncEvents(config, readQueue());
      const body = fetchMock.mock.calls[0][1].body as string;
      expect(body).not.toContain(canary);
      expect(JSON.parse(body).events[0]).toMatchObject({ sourceEventId: "claude-jsonl:msg-1:uuid-1", inputTokens: 10, outputTokens: 5 });
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("minimizes a legacy queue on read and blocks raw content from HTTP", async () => {
    const canary = "PRIVATE_BODY_TOOL_URL_TOKEN_CANARY";
    writeFileSync(tmp.queuePath, JSON.stringify({ ...event(1), rawJson: { message: { content: canary } }, extraBody: canary }) + "\n");
    const pending = readQueue();
    expect(readFileSync(tmp.queuePath, "utf8")).not.toContain(canary);
    fetchMock.mockResolvedValueOnce(okResponse(1));
    await syncEvents(config, pending);
    expect(fetchMock.mock.calls[0][1].body).not.toContain(canary);
  });

  it("rewrites legacy queue content and remote credentials before upload", async () => {
    const legacyEvent = {
      ...event(1),
      repoKey: "reader:FAKE_TOKEN@git.example/Team/Repo",
      gitRemote: "https://reader:FAKE_TOKEN@git.example/Team/Repo.git?key=FAKE_QUERY",
      rawJson: { message: { content: "PRIVATE_BODY_CANARY" } }
    };
    writeFileSync(tmp.queuePath, `${JSON.stringify(legacyEvent)}\n`);

    const pending = readQueue();
    const queue = readFileSync(tmp.queuePath, "utf8");
    expect(queue).not.toMatch(/FAKE_TOKEN|FAKE_QUERY|PRIVATE_BODY_CANARY/);
    expect(pending[0]).toMatchObject({
      repoKey: "git.example/Team/Repo",
      gitRemote: "https://git.example/Team/Repo.git"
    });

    fetchMock.mockResolvedValueOnce(okResponse(1));
    await syncEvents(config, pending);
    expect(fetchMock.mock.calls[0][1].body).not.toMatch(/FAKE_TOKEN|FAKE_QUERY|PRIVATE_BODY_CANARY/);
  });

  it("keeps local exception details out of default device diagnostics", () => {
    const canary = "PRIVATE_BODY_TOOL_URL_TOKEN_CANARY";
    writeFileSync(tmp.statePath, JSON.stringify({ lastError: `invalid JSON: ${canary}`, lastSyncStatus: "failed" }));
    try {
      const diagnostics = readDiagnostics();
      expect(diagnostics.lastError).toBeNull();
      expect(diagnostics.lastSyncStatus).toBe("failed");
      expect(JSON.stringify(diagnostics)).not.toContain(canary);
    } finally {
      rmSync(tmp.statePath, { force: true });
    }
  });

  it("still posts an empty batch so the server can advance lastSyncAt", async () => {
    const onBatchSynced = vi.fn();
    fetchMock.mockResolvedValueOnce(okResponse(0));

    const result = await syncEvents(config, [], { onBatchSynced });

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.events).toEqual([]);
    expect(onBatchSynced).toHaveBeenCalledWith({ synced: 0, total: 0, remaining: [] });
    expect(result.received).toBe(0);
  });

  it("scrubs a legacy queued remote before sending it over HTTP", async () => {
    const legacyEvent = {
      ...event(1),
      repoKey: "reader:FAKE_TOKEN@git.example/Team/Repo",
      gitRemote: "https://reader:FAKE_TOKEN@git.example/Team/Repo.git?key=FAKE_QUERY"
    };
    fetchMock.mockResolvedValueOnce(okResponse(1));

    await syncEvents(config, [legacyEvent]);

    const bodyText = fetchMock.mock.calls[0][1].body as string;
    const body = JSON.parse(bodyText);
    expect(body.events[0]).toMatchObject({
      repoKey: "git.example/Team/Repo",
      gitRemote: "https://git.example/Team/Repo.git"
    });
    expect(bodyText).not.toMatch(/FAKE_TOKEN|FAKE_QUERY/);
    expect(legacyEvent.gitRemote).toContain("FAKE_TOKEN");
  });

  it("retries a transiently failing batch instead of aborting the whole run", async () => {
    // 25+ events -> two batches. The second batch fails once at the network
    // level (proxy blip), then succeeds; the run must complete without
    // surfacing the transient error. Re-sending a batch is idempotent
    // server-side (skipDuplicates + compare-equal corrections).
    const events = Array.from({ length: 40 }, (_, i) => event(i));
    fetchMock
      .mockResolvedValueOnce(okResponse(25))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(okResponse(15));

    const pending = syncEvents(config, events);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.inserted).toBe(40);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("sends newest events first and checkpoints the remaining tail after each batch", async () => {
    const events = Array.from({ length: 30 }, (_, i) => event(i)).map((row, i) => ({
      ...row,
      occurredAt: new Date(Date.UTC(2026, 6, 3, 0, 0, i)).toISOString()
    }));
    const inputOrder = events.map((row) => row.sourceEventId);
    const onBatchSynced = vi.fn();
    fetchMock.mockResolvedValueOnce(okResponse(25)).mockResolvedValueOnce(okResponse(5));

    const result = await syncEvents(config, events, { onBatchSynced });

    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(firstBody.events).toHaveLength(25);
    expect(secondBody.events).toHaveLength(5);
    expect(firstBody.events[0].sourceEventId).toBe("evt-29");
    expect(firstBody.events.at(-1).sourceEventId).toBe("evt-5");
    expect(secondBody.events.map((row: UsageEventInput) => row.sourceEventId)).toEqual([
      "evt-4",
      "evt-3",
      "evt-2",
      "evt-1",
      "evt-0"
    ]);
    expect(onBatchSynced).toHaveBeenNthCalledWith(1, expect.objectContaining({
      synced: 25,
      total: 30,
      remaining: expect.arrayContaining([expect.objectContaining({ sourceEventId: "evt-4" })])
    }));
    expect(onBatchSynced).toHaveBeenLastCalledWith({ synced: 30, total: 30, remaining: [] });
    expect(result.received).toBe(30);
    expect(events.map((row) => row.sourceEventId)).toEqual(inputOrder);
  });

  it("gives up after exhausting batch retries", async () => {
    const events = Array.from({ length: 40 }, (_, i) => event(i));
    const onBatchSynced = vi.fn();
    fetchMock.mockResolvedValueOnce(okResponse(25)).mockRejectedValue(new TypeError("fetch failed"));

    const pending = syncEvents(config, events, { onBatchSynced });
    // Silence the expected rejection before advancing timers so Node does not
    // flag it as unhandled mid-flight.
    const outcome = pending.catch((error: Error) => error);
    await vi.runAllTimersAsync();
    const error = await outcome;

    expect(error).toBeInstanceOf(TypeError);
    // 1 initial attempt + 2 retries for the failing batch, after 1 successful batch.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(onBatchSynced).toHaveBeenCalledOnce();
    expect(onBatchSynced).toHaveBeenCalledWith(expect.objectContaining({ synced: 25, total: 40 }));
    expect(onBatchSynced.mock.calls[0][0].remaining).toHaveLength(15);
  });
});
