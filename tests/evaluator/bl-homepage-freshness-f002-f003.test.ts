/**
 * Independent evaluator probes for BL-HOMEPAGE-FRESHNESS F002/F003.
 *
 * These probes intentionally exercise the public sync boundary and real CLI
 * subprocesses instead of treating the generator-owned regression tests as
 * evidence.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageEventInput } from "@/shared/usage";

const mocks = vi.hoisted(() => ({
  agentFetch: vi.fn(),
  heartbeat: vi.fn(),
  readConfig: vi.fn(),
  readCursor: vi.fn(),
  writeCursor: vi.fn(),
  collectEvents: vi.fn(),
  readQueue: vi.fn(),
  dedupeBySourceEventId: vi.fn(),
  writeQueue: vi.fn(),
  clearQueue: vi.fn(),
  updateState: vi.fn(),
  runQuotaRefresh: vi.fn(),
  runHarnessSync: vi.fn()
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, appendFileSync: vi.fn() };
});
vi.mock("@/cli/fetch", () => ({ agentFetch: mocks.agentFetch }));
vi.mock("@/cli/config", () => ({
  queuePath: join(tmpdir(), "bl-homepage-evaluator-queue.jsonl"),
  statePath: join(tmpdir(), "bl-homepage-evaluator-state.json"),
  readCredentials: () => ({ deviceToken: "eval-token" }),
  readDevice: () => ({ id: "eval-device", name: "Evaluator" }),
  readConfig: mocks.readConfig,
  readState: vi.fn(() => ({})),
  updateState: mocks.updateState
}));
vi.mock("@/cli/collect", () => ({
  collectEvents: mocks.collectEvents,
  dedupeBySourceEventId: mocks.dedupeBySourceEventId,
  writeQueue: mocks.writeQueue
}));
vi.mock("@/cli/cursor", () => ({
  readCursor: mocks.readCursor,
  writeCursor: mocks.writeCursor
}));
vi.mock("@/cli/sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/cli/sync")>();
  return {
    ...actual,
    heartbeat: mocks.heartbeat,
    readQueue: mocks.readQueue,
    clearQueue: mocks.clearQueue
  };
});
vi.mock("@/quota/run", () => ({ runQuotaRefresh: mocks.runQuotaRefresh }));
vi.mock("@/cli/harness", () => ({ runHarnessSync: mocks.runHarnessSync }));

import { runOnce } from "@/cli/agent";
import { syncEvents } from "@/cli/sync";

const config = {
  serverUrl: "https://evaluator.invalid",
  projectRoots: [],
  sources: { claude: false, codex: false, opencode: false, aider: false, kimicode: false }
};

function event(id: string, occurredAt: string): UsageEventInput {
  return {
    source: "codex",
    sourceEventId: id,
    occurredAt,
    inputTokens: 1,
    outputTokens: 1
  };
}

function okResponse(received: number, call = 0): Response {
  return {
    ok: true,
    json: async () => ({
      inserted: Math.max(0, received - 1),
      updated: call,
      duplicates: received === 0 ? 0 : 1,
      received,
      deviceId: `device-${call}`
    })
  } as Response;
}

function bodyEvents(call: unknown[]): UsageEventInput[] {
  const init = call[1] as RequestInit;
  return (JSON.parse(String(init.body)) as { events: UsageEventInput[] }).events;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readConfig.mockReturnValue(config);
  mocks.heartbeat.mockResolvedValue({ ok: true });
  mocks.readCursor.mockReturnValue({ files: {}, opencodeLastTimeCreated: 0, claudeParserVersion: 2 });
  mocks.readQueue.mockReturnValue([]);
  mocks.collectEvents.mockReturnValue({ events: [], warnings: [] });
  mocks.dedupeBySourceEventId.mockImplementation((events: UsageEventInput[]) => {
    const byId = new Map<string, UsageEventInput>();
    for (const row of events) byId.set(`${row.source}:${row.sourceEventId}`, row);
    return [...byId.values()];
  });
  mocks.runQuotaRefresh.mockResolvedValue(undefined);
  mocks.runHarnessSync.mockResolvedValue({
    snapshot: { status: "clean" },
    reported: 0,
    failed: 0,
    applied: 0,
    stagedIntents: 0,
    issues: [],
    issueDetailsChanged: false,
    recovered: false
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("F002 adversarial upload contract", () => {
  it("caps batches at 25, uses a stable newest-first copy, aggregates, and checkpoints each tail", async () => {
    const stamps = [
      "2026-08-23T03:00:00.000Z",
      "2026-08-23T01:00:00.000Z",
      "not-a-date"
    ];
    const input = Array.from({ length: 57 }, (_, index) =>
      event(`evt-${index}`, stamps[index % stamps.length])
    );
    const originalJson = JSON.stringify(input);
    const originalRefs = [...input];
    const expected = [0, 1, 2]
      .flatMap((bucket) => input.filter((_, index) => index % 3 === bucket));
    const checkpoints: Array<{ synced: number; total: number; remaining: UsageEventInput[] }> = [];

    mocks.agentFetch.mockImplementation(async (...args: unknown[]) => {
      const rows = bodyEvents(args);
      return okResponse(rows.length, mocks.agentFetch.mock.calls.length - 1);
    });

    const result = await syncEvents(config, input, {
      onBatchSynced: (progress) => {
        checkpoints.push(progress);
      }
    });

    const sent = mocks.agentFetch.mock.calls.map(bodyEvents);
    expect(sent.map((batch) => batch.length)).toEqual([25, 25, 7]);
    expect(sent.every((batch) => batch.length <= 25)).toBe(true);
    expect(sent.flat().map((row) => row.sourceEventId)).toEqual(expected.map((row) => row.sourceEventId));
    expect(checkpoints.map(({ synced, total, remaining }) => [synced, total, remaining.length])).toEqual([
      [25, 57, 32],
      [50, 57, 7],
      [57, 57, 0]
    ]);
    expect(checkpoints[0].remaining.map((row) => row.sourceEventId)).toEqual(
      expected.slice(25).map((row) => row.sourceEventId)
    );
    expect(result).toEqual({ inserted: 54, updated: 3, duplicates: 3, received: 57, deviceId: "device-2" });
    expect(JSON.stringify(input)).toBe(originalJson);
    expect(input.every((row, index) => row === originalRefs[index])).toBe(true);
  });

  it("POSTs the empty batch and stops after the second batch exhausts all retries", async () => {
    const emptyProgress = vi.fn();
    mocks.agentFetch.mockResolvedValueOnce(okResponse(0));
    await expect(syncEvents(config, [], { onBatchSynced: emptyProgress })).resolves.toMatchObject({ received: 0 });
    expect(bodyEvents(mocks.agentFetch.mock.calls[0])).toEqual([]);
    expect(emptyProgress).toHaveBeenCalledWith({ synced: 0, total: 0, remaining: [] });

    vi.clearAllMocks();
    vi.useFakeTimers();
    const rows = Array.from({ length: 27 }, (_, index) =>
      event(`retry-${index}`, new Date(Date.UTC(2026, 7, 23, 0, 0, index)).toISOString())
    );
    const progress = vi.fn();
    mocks.agentFetch
      .mockResolvedValueOnce(okResponse(25))
      .mockRejectedValue(new TypeError("evaluator forced outage"));

    const pending = syncEvents(config, rows, { onBatchSynced: progress }).catch((error: Error) => error);
    await vi.runAllTimersAsync();
    const outcome = await pending;

    expect(outcome).toBeInstanceOf(TypeError);
    expect(mocks.agentFetch).toHaveBeenCalledTimes(4);
    expect(progress).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ synced: 25, total: 27 }));
    expect(progress.mock.calls[0][0].remaining).toHaveLength(2);
  });
});

describe("F003 durable failure states", () => {
  it("orders queue before cursor and retains the acknowledged batch tail when a later batch fails", async () => {
    vi.useFakeTimers();
    const rows = Array.from({ length: 31 }, (_, index) =>
      event(`durable-${index}`, new Date(Date.UTC(2026, 7, 23, 0, 0, index)).toISOString())
    );
    const cursor = { files: { log: { mtimeMs: 1, size: 2 } }, opencodeLastTimeCreated: 0, claudeParserVersion: 2 };
    const operations: string[] = [];
    let durable: UsageEventInput[] = [];
    mocks.readCursor.mockReturnValue(cursor);
    mocks.collectEvents.mockReturnValue({ events: rows, warnings: [] });
    mocks.writeQueue.mockImplementation((next: UsageEventInput[]) => {
      durable = structuredClone(next);
      operations.push(`queue:${next.length}`);
    });
    mocks.writeCursor.mockImplementation(() => operations.push("cursor"));
    mocks.agentFetch.mockImplementation(async (...args: unknown[]) => {
      const batch = bodyEvents(args);
      operations.push(`post:${batch.length}`);
      if (mocks.agentFetch.mock.calls.length === 1) return okResponse(batch.length);
      throw new TypeError("evaluator forced outage");
    });

    const pending = runOnce().catch((error: Error) => error);
    await vi.runAllTimersAsync();
    const outcome = await pending;

    expect(outcome).toBeInstanceOf(TypeError);
    expect(operations.slice(0, 4)).toEqual(["queue:31", "cursor", "post:25", "queue:6"]);
    expect(operations.filter((entry) => entry === "post:6")).toHaveLength(3);
    expect(durable.map((row) => row.sourceEventId)).toEqual([
      "durable-5",
      "durable-4",
      "durable-3",
      "durable-2",
      "durable-1",
      "durable-0"
    ]);
    expect(mocks.clearQueue).not.toHaveBeenCalled();
  });

  it("preserves a replay source or full queue across initial queue, cursor, and checkpoint write failures", async () => {
    const old = event("old", "2026-08-23T00:00:00.000Z");
    const fresh = event("fresh", "2026-08-23T01:00:00.000Z");
    const cursor = { files: {}, opencodeLastTimeCreated: 0, claudeParserVersion: 2 };
    let durable = [old];
    mocks.readQueue.mockReturnValue([old]);
    mocks.collectEvents.mockReturnValue({ events: [fresh], warnings: [] });
    mocks.readCursor.mockReturnValue(cursor);

    mocks.writeQueue.mockImplementationOnce(() => {
      throw new Error("initial queue write failed");
    });
    await expect(runOnce()).rejects.toThrow("initial queue write failed");
    expect(durable).toEqual([old]);
    expect(mocks.writeCursor).not.toHaveBeenCalled();
    expect(mocks.agentFetch).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.readConfig.mockReturnValue(config);
    mocks.heartbeat.mockResolvedValue({ ok: true });
    mocks.readQueue.mockReturnValue([old]);
    mocks.collectEvents.mockReturnValue({ events: [fresh], warnings: [] });
    mocks.readCursor.mockReturnValue(cursor);
    mocks.dedupeBySourceEventId.mockImplementation((rows: UsageEventInput[]) => rows);
    mocks.writeQueue.mockImplementation((next: UsageEventInput[]) => {
      durable = structuredClone(next);
    });
    mocks.writeCursor.mockImplementationOnce(() => {
      throw new Error("cursor write failed");
    });
    await expect(runOnce()).rejects.toThrow("cursor write failed");
    expect(durable.map((row) => row.sourceEventId)).toEqual(["old", "fresh"]);
    expect(mocks.agentFetch).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.readConfig.mockReturnValue(config);
    mocks.heartbeat.mockResolvedValue({ ok: true });
    mocks.readQueue.mockReturnValue([]);
    const many = Array.from({ length: 26 }, (_, index) =>
      event(`checkpoint-${index}`, new Date(Date.UTC(2026, 7, 23, 0, 0, index)).toISOString())
    );
    mocks.collectEvents.mockReturnValue({ events: many, warnings: [] });
    mocks.readCursor.mockReturnValue(cursor);
    mocks.dedupeBySourceEventId.mockImplementation((rows: UsageEventInput[]) => rows);
    let writes = 0;
    mocks.writeQueue.mockImplementation((next: UsageEventInput[]) => {
      writes += 1;
      if (writes === 2) throw new Error("checkpoint write failed");
      durable = structuredClone(next);
    });
    mocks.agentFetch.mockImplementation(async (...args: unknown[]) => okResponse(bodyEvents(args).length));
    await expect(runOnce()).rejects.toThrow("checkpoint write failed");
    expect(durable).toHaveLength(26);
    expect(mocks.agentFetch).toHaveBeenCalledOnce();
    expect(mocks.clearQueue).not.toHaveBeenCalled();
  });
});

type CliObservation = {
  command: "sync" | "run";
  batches: string[][];
  queueAtRequest: string[][];
  cursorAtRequest: boolean[];
};

function readQueueIds(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as UsageEventInput).sourceEventId);
}

function spawnCli(command: "sync" | "run", home: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "src/cli/index.ts", command], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} CLI timed out`));
    }, 20_000);
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe("F003 real CLI/daemon parity", () => {
  it("checkpoints the same remaining tail between real sync and run subprocess batches", async () => {
    const homes: string[] = [];
    const observations: CliObservation[] = [];
    let active: CliObservation | null = null;
    let activeQueuePath = "";
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        response.setHeader("content-type", "application/json");
        if (request.url === "/api/devices/heartbeat") {
          response.end(JSON.stringify({ ok: true, deviceId: "cli-eval", lastSeenAt: new Date().toISOString() }));
          return;
        }
        if (request.url !== "/api/usage/events/batch" || !active) {
          response.statusCode = 404;
          response.end(JSON.stringify({ error: "not found" }));
          return;
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { events: UsageEventInput[] };
        active.batches.push(payload.events.map((row) => row.sourceEventId));
        active.queueAtRequest.push(readQueueIds(activeQueuePath));
        active.cursorAtRequest.push(existsSync(join(activeQueuePath, "..", "cursor.json")));
        response.end(JSON.stringify({
          inserted: payload.events.length,
          updated: 0,
          duplicates: 0,
          received: payload.events.length,
          deviceId: "cli-eval"
        }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("evaluator server did not bind TCP");
      for (const command of ["sync", "run"] as const) {
        const home = mkdtempSync(join(tmpdir(), `bl-homepage-${command}-`));
        homes.push(home);
        const dir = join(home, ".tokenizer");
        mkdirSync(dir, { recursive: true });
        mkdirSync(join(home, "empty-projects"), { recursive: true });
        activeQueuePath = join(dir, "queue.jsonl");
        const rows = Array.from({ length: 30 }, (_, index) =>
          event(`cli-${index}`, new Date(Date.UTC(2026, 7, 23, 0, 0, index)).toISOString())
        );
        writeFileSync(join(dir, "config.json"), `${JSON.stringify({
          serverUrl: `http://127.0.0.1:${address.port}`,
          projectRoots: [join(home, "empty-projects")],
          sources: { claude: false, codex: false, opencode: false, aider: false, kimicode: false }
        })}\n`);
        writeFileSync(join(dir, "device.json"), `${JSON.stringify({ id: "cli-eval", name: "Evaluator" })}\n`);
        writeFileSync(join(dir, "credentials.json"), `${JSON.stringify({ deviceToken: "cli-token" })}\n`);
        writeFileSync(activeQueuePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
        active = { command, batches: [], queueAtRequest: [], cursorAtRequest: [] };

        const result = await spawnCli(command, home);
        expect(result, result.stderr).toMatchObject({ code: 0 });
        expect(result.stdout).toContain("Synced 30 events");
        expect(readQueueIds(activeQueuePath)).toEqual([]);
        observations.push(active);
      }
    } finally {
      active = null;
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      for (const home of homes) rmSync(home, { recursive: true, force: true });
    }

    for (const observation of observations) {
      expect(observation.batches.map((batch) => batch.length)).toEqual([25, 5]);
      expect(observation.batches[0]).toEqual(Array.from({ length: 25 }, (_, index) => `cli-${29 - index}`));
      expect(observation.batches[1]).toEqual(["cli-4", "cli-3", "cli-2", "cli-1", "cli-0"]);
      expect(observation.queueAtRequest[0]).toHaveLength(30);
      expect(observation.queueAtRequest[1]).toEqual(observation.batches[1]);
    }
    expect(observations.find(({ command }) => command === "sync")?.cursorAtRequest).toEqual([false, false]);
    expect(observations.find(({ command }) => command === "run")?.cursorAtRequest).toEqual([true, true]);
    expect(observations.map(({ batches, queueAtRequest }) => ({ batches, queueAtRequest }))[0]).toEqual(
      observations.map(({ batches, queueAtRequest }) => ({ batches, queueAtRequest }))[1]
    );
  }, 30_000);
});
