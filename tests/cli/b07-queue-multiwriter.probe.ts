import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
  if (mode === "collect" || mode === "correct") {
    const { writeQueue } = await import("../../src/cli/collect");
    writeQueue([mode === "collect" ? event("newly-collected") : event("same-id", 2)]);
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

async function withServer(
  handler: (ids: string[], requestNo: number, response: import("node:http").ServerResponse) => Promise<void>,
  run: (url: string) => Promise<void>
) {
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
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function main() {
  if (await childMode()) return;
  const home = mkdtempSync(join(tmpdir(), "b07-queue-multiwriter-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]) delete process.env[key];
  const configDir = join(home, ".tokenizer");
  mkdirSync(configDir);
  writeFileSync(join(configDir, "device.json"), JSON.stringify({ id: "device-a", name: "B07 probe" }));
  writeFileSync(join(configDir, "credentials.json"), JSON.stringify({ deviceToken: "synthetic" }));

  const { readQueue, syncEvents } = await import("../../src/cli/sync");
  const { writeQueue } = await import("../../src/cli/collect");
  const { readRejectedUsageEvents } = await import("../../src/cli/rejected-events");
  const config = (url: string) => ({ serverUrl: url, privacy: { mode: "sync", includePaths: [], excludePaths: [] } }) as Parameters<typeof syncEvents>[0];
  const observations: Record<string, unknown> = {};

  try {
    const poison = { ...event("poison"), source: "unknown" } as unknown as UsageEventInput;
    writeQueue([event("good"), poison]);
    await withServer(async (ids, _requestNo, response) => {
      assert.deepEqual(ids, ["good", "poison"]);
      await runChild("collect");
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        inserted: 1, duplicates: 0, received: 1, deviceId: "device-a",
        protocol: "usage-partial-v1",
        accepted: [{ row: 0, source: "aider", sourceEventId: "good" }],
        rejected: [{ row: 1, code: "invalid_event" }]
      }));
    }, async (url) => {
      // Keep the old callback shape in the probe: writeQueue is now a merge,
      // so even a stale observer cannot truncate a concurrent writer.
      await syncEvents(config(url), readQueue(), { onBatchSynced: ({ remaining }) => { writeQueue(remaining); } });
    });
    observations.concurrent = {
      queue: readQueue().map((row) => row.sourceEventId),
      rejected: readRejectedUsageEvents().map((row) => row.event.sourceEventId)
    };
    assert.deepEqual(observations.concurrent, { queue: ["newly-collected"], rejected: ["poison"] });

    rmSync(join(configDir, "queue.jsonl"), { force: true });
    writeQueue([event("same-id", 1)]);
    await withServer(async (ids, _requestNo, response) => {
      assert.deepEqual(ids, ["same-id"]);
      await runChild("correct");
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        inserted: 1, duplicates: 0, received: 1, deviceId: "device-a",
        protocol: "usage-partial-v1",
        accepted: [{ row: 0, source: "aider", sourceEventId: "same-id" }],
        rejected: []
      }));
    }, async (url) => { await syncEvents(config(url), readQueue()); });
    observations.version = readQueue().map((row) => ({ id: row.sourceEventId, inputTokens: row.inputTokens }));
    assert.deepEqual(observations.version, [{ id: "same-id", inputTokens: 2 }]);

    rmSync(join(configDir, "queue.jsonl"), { force: true });
    writeQueue([event("crash-retry")]);
    let firstRequest!: () => void;
    const requestSeen = new Promise<void>((resolve) => { firstRequest = resolve; });
    await withServer(async (ids, requestNo, response) => {
      assert.deepEqual(ids, ["crash-retry"]);
      if (requestNo === 1) {
        firstRequest();
        return;
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ inserted: 0, duplicates: 1, received: 1, deviceId: "device-a" }));
    }, async (url) => {
      const first = spawn(process.execPath, [tsx, script, "sync", url], { env: process.env, stdio: "ignore" });
      await requestSeen;
      first.kill();
      await new Promise<void>((resolve) => first.on("exit", () => resolve()));
      assert.deepEqual(readQueue().map((row) => row.sourceEventId), ["crash-retry"]);
      await runChild("sync", [url]);
    });
    observations.crashRetry = readQueue().map((row) => row.sourceEventId);
    assert.deepEqual(observations.crashRetry, []);

    rmSync(join(configDir, "queue.jsonl"), { force: true });
    const rowlessPoison = { ...event("rowless-poison"), model: "\ud800" };
    writeQueue([event("rowless-good-a"), rowlessPoison, event("rowless-good-b")]);
    const rowlessRequests: string[][] = [];
    await withServer(async (ids, _requestNo, response) => {
      rowlessRequests.push(ids);
      response.statusCode = ids.includes("rowless-poison") ? 400 : 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(ids.includes("rowless-poison")
        ? { code: "invalid_json" }
        : { inserted: ids.length, duplicates: 0, received: ids.length, deviceId: "device-a" }));
    }, async (url) => { await syncEvents(config(url), readQueue()); });
    observations.priorServerRowless = {
      requests: rowlessRequests,
      queue: readQueue().map((row) => row.sourceEventId),
      rejected: readRejectedUsageEvents().map((row) => row.event.sourceEventId)
    };
    assert.equal(rowlessRequests.length, 7);
    assert.deepEqual(readQueue(), []);
    assert(readRejectedUsageEvents().some((row) => row.event.sourceEventId === "rowless-poison"));

    console.log(JSON.stringify(observations));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

await main();
