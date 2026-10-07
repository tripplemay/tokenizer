import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UsageEventInput } from "@/shared/usage";

const fixture = vi.hoisted(() => {
  const root = `${process.env.TMPDIR || process.env.TEMP || "/tmp"}/composition-prereview-${process.pid}`;
  return {
    root,
    queuePath: `${root}/queue.jsonl`,
    rejectedUsagePath: `${root}/rejected.jsonl`,
    statePath: `${root}/state.json`,
    config: undefined as unknown,
    fetch: vi.fn()
  };
});

vi.mock("@/cli/config", () => ({
  queuePath: fixture.queuePath,
  rejectedUsagePath: fixture.rejectedUsagePath,
  statePath: fixture.statePath,
  readConfig: () => fixture.config,
  readCredentials: () => ({ deviceToken: "synthetic" }),
  readDevice: () => ({ id: "synthetic-device", name: "synthetic" })
}));
vi.mock("@/cli/fetch", () => ({ agentFetch: fixture.fetch }));
vi.mock("@/cli/agent-version", () => ({ getAgentVersion: () => "test" }));

import { mergeQueue, queueEventVersion, readQueue, resolveQueueEvents } from "@/cli/queue";
import { readRejectedUsageEvents } from "@/cli/rejected-events";
import { dryRunBoundedReplay, executeBoundedReplay, readBoundedReplayFile } from "@/cli/replay";
import { planBoundedReplay } from "@/cli/replay-contract";
import { mayCollectEvent } from "@/cli/privacy";
import { syncEvents } from "@/cli/sync";
import { parseClaudeJsonlBuffer } from "@/parsers/claude";

const roots: string[] = [];
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const event = (id: string, inputTokens: number): UsageEventInput => ({
  source: "claude-code", sourceEventId: id, occurredAt: "2026-10-07T12:00:00.000Z", inputTokens, totalTokens: inputTokens
});

function replayFixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "composition-replay-"));
  roots.push(root);
  const file = join(root, "one.jsonl");
  const row = {
    type: "assistant", uuid: "one", cwd: root, timestamp: "2026-10-07T12:00:00.000Z",
    message: { role: "assistant", id: "one", usage: { input_tokens: 1 } }
  };
  const bytes = Buffer.from(`${JSON.stringify(row)}\n`);
  writeFileSync(file, bytes);
  const config = {
    serverUrl: "http://127.0.0.1:9", projectRoots: [],
    sources: { claude: true, codex: false, opencode: false, aider: false, kimicode: false },
    privacy: { mode: "local-only" as const, includePaths: [root], excludePaths: [] }
  };
  const request = {
    source: "claude-code", file, from: "2026-10-07T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z",
    maxBytes: 100_000, maxEvents: 10
  };
  const parsed = parseClaudeJsonlBuffer({ file, bytes, mtime: new Date(row.timestamp), projectRoots: [] }).events[0];
  fixture.config = config;
  return { root, file, config, request, parsed };
}

beforeEach(() => {
  rmSync(fixture.root, { recursive: true, force: true });
  fixture.fetch.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(fixture.root, { recursive: true, force: true });
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("interleaves in-flight old ACK, confirmed replay, and fresh collection without erasing either new version", async () => {
  const { config, request, parsed } = replayFixture();
  const old = { ...parsed, inputTokens: 99, totalTokens: 99 };
  const fresh = event("fresh-collect", 5);
  const poison = event("poison", 8);
  mergeQueue([old, poison]);
  const preview = dryRunBoundedReplay(planBoundedReplay(request), config);
  let replay: ReturnType<typeof executeBoundedReplay> | undefined;
  fixture.fetch.mockImplementationOnce(async () => {
    replay = executeBoundedReplay(planBoundedReplay({ ...request, dryRun: false }), config, preview.planDigest);
    mergeQueue([fresh]);
    return Response.json({
      protocol: "usage-partial-v1", inserted: 1, duplicates: 0, received: 1,
      accepted: [{ row: 0, source: old.source, sourceEventId: old.sourceEventId }],
      rejected: [{ row: 1, code: "invalid_event" }]
    });
  });
  const result = await syncEvents({ ...config, privacy: { ...config.privacy, mode: "sync" } }, [old, poison]);
  const active = readQueue();
  expect(result).toMatchObject({ received: 1, rejected: 1 });
  expect(replay).toMatchObject({ admitted: 1, backlog: 3 });
  expect(active.map((row) => [row.sourceEventId, row.inputTokens])).toEqual([
    [parsed.sourceEventId, 1], [fresh.sourceEventId, 5]
  ]);
  expect(readRejectedUsageEvents().map((row) => row.event.sourceEventId)).toEqual(["poison"]);
});

it("keeps a later rejected same-ID correction separately recoverable from the old quarantine", () => {
  const old = event("same", 1);
  const corrected = event("same", 200);
  mergeQueue([old]);
  resolveQueueEvents({ accepted: [], rejected: [{ event: old, code: "invalid_event" }] });
  mergeQueue([corrected]);
  resolveQueueEvents({ accepted: [], rejected: [{ event: corrected, code: "invalid_event" }] });
  expect(readQueue()).toEqual([]);
  expect(readRejectedUsageEvents().map((row) => queueEventVersion(row.event)))
    .toEqual([queueEventVersion(old), queueEventVersion(corrected)]);
});

it("checks the deadline guard while holding the lock and leaves legacy bytes unchanged on refusal", () => {
  mkdirSync(fixture.root);
  const legacy = `{ "source": "claude-code", "sourceEventId": "old", "occurredAt": "2026-10-07T12:00:00.000Z" }\r\n`;
  writeFileSync(fixture.queuePath, legacy);
  let held = false;
  expect(() => mergeQueue([event("new", 2)], fixture.queuePath, {
    timeoutMs: 100,
    beforeMutate: () => {
      held = existsSync(`${fixture.queuePath}.lock`);
      throw new Error("Replay refused: queue admission exceeded 10000ms deadline");
    }
  })).toThrow("queue admission exceeded");
  expect(held).toBe(true);
  expect(readFileSync(fixture.queuePath, "utf8")).toBe(legacy);
  writeFileSync(`${fixture.queuePath}.lock`, "held");
  expect(() => mergeQueue([event("also-new", 3)], fixture.queuePath, { timeoutMs: 20 })).toThrow(/Timed out/);
  expect(readFileSync(fixture.queuePath, "utf8")).toBe(legacy);
});

it("does not touch legacy queue, config, cursor or state bytes in dry-run", () => {
  const { config, request } = replayFixture();
  mkdirSync(fixture.root);
  const files = {
    queue: fixture.queuePath,
    config: join(fixture.root, "config.json"),
    cursor: join(fixture.root, "cursor.json"),
    state: fixture.statePath
  };
  writeFileSync(files.queue, `{ "source": "claude-code", "sourceEventId": "legacy", "occurredAt": "2026-10-07T01:00:00.000Z" }\r\n`);
  writeFileSync(files.config, "{\r\n  \"legacy\": true\r\n}\r\n");
  writeFileSync(files.cursor, "{\r\n  \"cursor\": 1\r\n}\r\n");
  writeFileSync(files.state, "{\r\n  \"state\": 1\r\n}\r\n");
  const before = Object.fromEntries(Object.entries(files).map(([name, path]) => [name, sha(readFileSync(path))]));
  const preview = dryRunBoundedReplay(planBoundedReplay(request), config);
  expect(preview).toMatchObject({ wouldAdmit: 1 });
  expect(Object.fromEntries(Object.entries(files).map(([name, path]) => [name, sha(readFileSync(path))]))).toEqual(before);
  expect(existsSync(`${fixture.queuePath}.lock`)).toBe(false);
});

it("refuses a symlink source parent and filters a lexically included but physically excluded workspace", () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "composition-scope-"));
  roots.push(root);
  const allowed = join(root, "allowed");
  const blocked = join(root, "blocked");
  mkdirSync(allowed); mkdirSync(blocked);
  const source = join(blocked, "secret.jsonl");
  writeFileSync(source, "{}\n");
  const alias = join(allowed, "alias");
  symlinkSync(blocked, alias, process.platform === "win32" ? "junction" : "dir");
  expect(() => readBoundedReplayFile(join(alias, "secret.jsonl"), 1000)).toThrow(/non-symlink directory/);
  expect(mayCollectEvent({ ...event("scope", 1), workspacePath: join(alias, "secret.jsonl") }, {
    mode: "local-only", includePaths: [allowed], excludePaths: [blocked]
  })).toBe(false);
});

it("isolates old-server rowless invalid_json but never quarantines when the empty envelope fails", async () => {
  const good = event("good", 1);
  const poison = event("poison", 2);
  mergeQueue([good, poison]);
  const batches: string[][] = [];
  fixture.fetch.mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { events: UsageEventInput[] };
    batches.push(body.events.map((row) => row.sourceEventId));
    if (body.events.some((row) => row.sourceEventId === "poison")) return Response.json({ code: "invalid_json" }, { status: 400 });
    return Response.json({ inserted: body.events.length, duplicates: 0, received: body.events.length });
  });
  await expect(syncEvents({ serverUrl: "http://127.0.0.1:9" } as Parameters<typeof syncEvents>[0], [good, poison]))
    .resolves.toMatchObject({ received: 1, rejected: 1 });
  expect(batches).toContainEqual([]);
  expect(readRejectedUsageEvents().map((row) => row.event.sourceEventId)).toEqual(["poison"]);
  const stillBad = event("still-bad", 3);
  mergeQueue([stillBad]);
  fixture.fetch.mockReset();
  fixture.fetch.mockResolvedValue(Response.json({ code: "invalid_json" }, { status: 400 }));
  await expect(syncEvents({ serverUrl: "http://127.0.0.1:9" } as Parameters<typeof syncEvents>[0], [stillBad]))
    .rejects.toThrow("Sync failed: 400 invalid_json");
  expect(readQueue().map(queueEventVersion)).toContain(queueEventVersion(stillBad));
  expect(readRejectedUsageEvents().map((row) => row.event.sourceEventId)).toEqual(["poison"]);
});

it("two independent processes merge different versions under the real queue lock", async () => {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "composition-writers-"));
  roots.push(home);
  const worker = join(process.cwd(), "tests/fixtures/b07-prereview-worker.ts");
  const run = (input: UsageEventInput[]) => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", worker, "merge", JSON.stringify(input)], {
      cwd: process.cwd(), env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (part) => { stderr += part; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr)));
  });
  await Promise.all([run([event("same", 1), event("writer-a", 3)]), run([event("same", 2), event("writer-b", 4)])]);
  const queue = join(home, ".tokenizer", "queue.jsonl");
  const active = readFileSync(queue, "utf8").trim().split("\n").map((line) => JSON.parse(line) as UsageEventInput);
  expect(active.map(queueEventVersion).sort()).toEqual([
    event("same", 1), event("same", 2), event("writer-a", 3), event("writer-b", 4)
  ].map(queueEventVersion).sort());
  if (process.platform !== "win32") {
    expect(statSync(join(home, ".tokenizer")).mode & 0o777).toBe(0o700);
    expect(statSync(queue).mode & 0o777).toBe(0o600);
  }
});
