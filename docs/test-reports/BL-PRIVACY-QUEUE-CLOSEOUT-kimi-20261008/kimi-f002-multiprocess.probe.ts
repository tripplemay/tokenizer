// Independent F002 real multiprocess + loopback HTTP probe (Kimi evaluator).
// Spec control 8: two-process interleaving, quarantine write failure, crash/retry.
// Synthetic HOME only; real src/cli queue, sync, atomic-file and undici fetch paths.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UsageEventInput } from "../../src/shared/usage";

const event = (id: string, inputTokens = 1): UsageEventInput => ({
  source: "aider",
  sourceEventId: id,
  occurredAt: "2026-10-08T00:00:00.000Z",
  inputTokens
});

async function childMode() {
  const mode = process.argv[2];
  if (mode === "storm") {
    const prefix = process.argv[3];
    const { writeQueue } = await import("../../src/cli/collect");
    writeQueue([event(`${prefix}-a`), event(`${prefix}-b`), event(`${prefix}-c`), event(`${prefix}-d`), event("shared")]);
    return true;
  }
  if (mode === "write") {
    const { writeQueue } = await import("../../src/cli/collect");
    writeQueue([event(process.argv[3], Number(process.argv[4]))]);
    return true;
  }
  if (mode === "sync") {
    const { readQueue, syncEvents } = await import("../../src/cli/sync");
    await syncEvents(
      { serverUrl: process.argv[3], privacy: { mode: "sync", includePaths: [], excludePaths: [] } } as Parameters<typeof syncEvents>[0],
      readQueue()
    );
    return true;
  }
  return false;
}

const tsx = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const script = process.argv[1];

function runChild(mode: string, extra: string[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsx, script, mode, ...extra], {
      env: process.env,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${mode} exit ${code}: ${stderr}`)));
  });
}

type Handler = (ids: string[], requestNo: number, response: import("node:http").ServerResponse) => void | Promise<void>;
async function withServer(handler: Handler, run: (url: string) => Promise<void>) {
  let requestNo = 0;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { events: UsageEventInput[] };
    requestNo += 1;
    await handler(body.events.map((row) => row.sourceEventId), requestNo, response);
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    // A deliberately-hung request (crash simulation) outlives its dead client;
    // force-close it so server.close() is not gated on a zombie connection.
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function partial(accepted: Array<{ row: number; source: string; sourceEventId: string }>,
                 rejected: Array<{ row: number; code: string }>) {
  return JSON.stringify({
    inserted: accepted.length, duplicates: 0, received: accepted.length,
    protocol: "usage-partial-v1", accepted, rejected
  });
}

async function main() {
  if (await childMode()) return;
  const home = mkdtempSync(join(tmpdir(), "kf2-probe-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]) delete process.env[key];
  const configDir = join(home, ".tokenizer");
  mkdirSync(configDir);
  writeFileSync(join(configDir, "device.json"), JSON.stringify({ id: "device-k", name: "Kimi F002 probe" }));
  writeFileSync(join(configDir, "credentials.json"), JSON.stringify({ deviceToken: "synthetic" }));
  const queueFile = join(configDir, "queue.jsonl");
  const rejectedFile = join(configDir, "rejected-usage.jsonl");

  const { readQueue, syncEvents } = await import("../../src/cli/sync");
  const { resolveQueueEvents, writeQueue } = await import("../../src/cli/collect");
  const { readRejectedUsageEvents } = await import("../../src/cli/rejected-events");
  const config = (url: string) => ({ serverUrl: url, privacy: { mode: "sync", includePaths: [], excludePaths: [] } }) as Parameters<typeof syncEvents>[0];
  const observations: Record<string, unknown> = {};

  try {
    // S1: six processes concurrently merge distinct + one identical shared event.
    await Promise.all([0, 1, 2, 3, 4, 5].map((n) => runChild("storm", [`p${n}`])));
    const stormLines = readFileSync(queueFile, "utf8").split("\n").filter(Boolean);
    const stormIds = stormLines.map((line) => (JSON.parse(line) as UsageEventInput).sourceEventId).sort();
    assert.equal(stormLines.length, 25, `expected 6*4+1 unique versions, got ${stormLines.length}`);
    assert(stormLines.every((line) => { try { JSON.parse(line); return true; } catch { return false; } }), "no torn JSONL lines");
    observations.mergeStorm = { lines: stormLines.length, mode: (statSync(queueFile).mode & 0o777).toString(8) };

    // S2: ACK of the old version keeps the concurrently written correction;
    // two distinct rejected corrections of one ID are BOTH durable in quarantine.
    rmSync(queueFile, { force: true });
    rmSync(rejectedFile, { force: true });
    writeQueue([event("sid", 1)]);
    await withServer(async (ids, _n, response) => {
      assert.deepEqual(ids, ["sid"]);
      await runChild("write", ["sid", "2"]); // concurrent correction during in-flight ACK
      response.setHeader("content-type", "application/json");
      response.end(partial([{ row: 0, source: "aider", sourceEventId: "sid" }], []));
    }, async (url) => { await syncEvents(config(url), readQueue()); });
    assert.deepEqual(readQueue().map((row) => row.inputTokens), [2], "correction survived ACK of old version");

    await withServer(async (ids, _n, response) => {
      assert.deepEqual(ids, ["sid"]);
      response.setHeader("content-type", "application/json");
      response.end(partial([], [{ row: 0, code: "invalid_event" }]));
    }, async (url) => { await syncEvents(config(url), readQueue()); });
    assert.equal(readQueue().length, 0);
    assert.equal(readRejectedUsageEvents().length, 1);

    writeQueue([event("sid", 3)]); // a NEWER correction of the same ID, rejected again
    await withServer(async (ids, _n, response) => {
      assert.deepEqual(ids, ["sid"]);
      response.setHeader("content-type", "application/json");
      response.end(partial([], [{ row: 0, code: "invalid_event" }]));
    }, async (url) => { await syncEvents(config(url), readQueue()); });
    const quarantined = readRejectedUsageEvents().map((row) => row.event.inputTokens).sort();
    assert.deepEqual(quarantined, [2, 3], "prior same-ID quarantine row must not suppress the new correction");
    // Idempotent replay of the same rejection over the queue API: still two rows.
    resolveQueueEvents({ accepted: [], rejected: [{ event: event("sid", 3), code: "invalid_event" }] });
    assert.equal(readRejectedUsageEvents().length, 2);
    observations.versionedQuarantine = quarantined;

    // S3: quarantine write failure preserves the active queue byte-for-byte.
    rmSync(queueFile, { force: true });
    rmSync(rejectedFile, { force: true });
    writeQueue([event("qf-poison"), event("qf-good")]);
    mkdirSync(rejectedFile); // quarantine path is now a directory: writes must fail
    const queueBefore = readFileSync(queueFile, "utf8");
    const resolveByActualRow = (ids: string[]) => JSON.stringify({
      inserted: 1, duplicates: 0, received: ids.filter((id) => id === "qf-good").length,
      protocol: "usage-partial-v1",
      accepted: ids.map((id, row) => ({ row, source: "aider", sourceEventId: id })).filter((row) => row.sourceEventId === "qf-good"),
      rejected: ids.map((id, row) => ({ row, id, code: "invalid_event" })).filter((row) => row.id === "qf-poison").map(({ row, code }) => ({ row, code }))
    });
    await withServer(async (_ids, _n, response) => {
      response.setHeader("content-type", "application/json");
      response.end(resolveByActualRow(_ids));
    }, async (url) => {
      await assert.rejects(syncEvents(config(url), readQueue()), "resolution must fail when quarantine cannot persist");
    });
    assert.equal(readFileSync(queueFile, "utf8"), queueBefore, "active queue unchanged after quarantine failure");
    rmSync(rejectedFile, { recursive: true, force: true });
    // Retry with a healthy quarantine path: resolution completes, nothing lost.
    await withServer(async (_ids, _n, response) => {
      response.setHeader("content-type", "application/json");
      response.end(resolveByActualRow(_ids));
    }, async (url) => { await syncEvents(config(url), readQueue()); });
    assert.equal(readQueue().length, 0);
    assert.deepEqual(readRejectedUsageEvents().map((row) => row.event.sourceEventId), ["qf-poison"]);
    observations.quarantineFailure = { preservedBytes: true, retriedToEmpty: true };

    // S4: killed mid-sync child loses nothing; retry duplicates but resolves.
    rmSync(queueFile, { force: true });
    writeQueue([event("crashy")]);
    let seen!: () => void;
    const requestSeen = new Promise<void>((resolve) => { seen = resolve; });
    let requests = 0;
    await withServer(async (ids, requestNo, response) => {
      assert.deepEqual(ids, ["crashy"]);
      requests = requestNo;
      if (requestNo === 1) { seen(); return; } // hang: child is killed before any resolution
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ inserted: 0, duplicates: 1, received: 1, deviceId: "device-k" }));
    }, async (url) => {
      const first = spawn(process.execPath, [tsx, script, "sync", url], { env: process.env, stdio: "ignore" });
      await requestSeen;
      first.kill("SIGKILL");
      await new Promise<void>((resolve) => first.on("exit", () => resolve()));
      assert.deepEqual(readQueue().map((row) => row.sourceEventId), ["crashy"], "event survives killed child");
      await runChild("sync", [url]);
    });
    assert.deepEqual(readQueue(), []);
    assert.equal(requests, 2, "retry re-sent the batch (duplicate tolerated server-side)");
    observations.crashRetry = { queueAfterRetry: 0, serverRequests: requests };

    console.log(JSON.stringify(observations));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

await main();
