import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UsageEventInput } from "../../../src/shared/usage";

const event = (id: string): UsageEventInput => ({
  source: "aider",
  sourceEventId: id,
  occurredAt: "2026-10-08T00:00:00.000Z",
  inputTokens: 1
});

async function main() {
  if (process.argv[2] === "collect") {
    const { readQueue } = await import("../../../src/cli/sync.ts");
    const { dedupeBySourceEventId, writeQueue } = await import("../../../src/cli/collect.ts");
    writeQueue(dedupeBySourceEventId([...readQueue(), event("newly-collected")]));
    return;
  }

  const home = mkdtempSync(join(tmpdir(), "b06-queue-loss-"));
  process.env.HOME = home;
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]) {
    delete process.env[key];
  }
  const configDir = join(home, ".tokenizer");
  mkdirSync(configDir);
  writeFileSync(join(configDir, "device.json"), JSON.stringify({ id: "device-a", name: "B06 probe" }));
  writeFileSync(join(configDir, "credentials.json"), JSON.stringify({ deviceToken: "synthetic" }));

  const { readQueue, syncEvents } = await import("../../../src/cli/sync.ts");
  const { writeQueue } = await import("../../../src/cli/collect.ts");
  const { readRejectedUsageEvents } = await import("../../../src/cli/rejected-events.ts");
  const poison = { ...event("poison"), source: "unknown" } as unknown as UsageEventInput;
  writeQueue([event("good"), poison]);

  const received: string[][] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { events: UsageEventInput[] };
    received.push(body.events.map((row) => row.sourceEventId));
    assert.equal(request.headers["x-tokenizer-batch-protocol"], "usage-partial-v1");

    const child = spawn(process.execPath, [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), process.argv[1], "collect"], {
      env: process.env,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
    const exit = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", resolve);
    });
    assert.equal(exit, 0, stderr);
    assert.deepEqual(readQueue().map((row) => row.sourceEventId), ["good", "poison", "newly-collected"]);

    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      inserted: 1,
      duplicates: 0,
      received: 1,
      deviceId: "device-a",
      protocol: "usage-partial-v1",
      accepted: [{ row: 0, source: "aider", sourceEventId: "good" }],
      rejected: [{ row: 1, code: "invalid_event" }]
    }));
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    const result = await syncEvents(
      { serverUrl: `http://127.0.0.1:${address.port}`, privacy: { mode: "sync", includePaths: [], excludePaths: [] } } as Parameters<typeof syncEvents>[0],
      readQueue(),
      { onBatchSynced: ({ remaining }) => writeQueue(remaining) }
    );
    const finalIds = readQueue().map((row) => row.sourceEventId);
    const quarantinedIds = readRejectedUsageEvents().map((row) => row.event.sourceEventId);
    const observation = { result, requests: received, finalIds, quarantinedIds,
      queueRaw: readFileSync(join(configDir, "queue.jsonl"), "utf8") };
    console.log(JSON.stringify(observation, null, 2));
    assert.deepEqual(received, [["good", "poison"]]);
    assert.deepEqual(finalIds, []);
    assert.deepEqual(quarantinedIds, ["poison"]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(home, { recursive: true, force: true });
  }
}

await main();
