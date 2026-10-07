import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invalidBatchResponse, readBoundedBatchJson } from "../../../src/server/batch-input";
import type { UsageEventInput } from "../../../src/shared/usage";

const home = mkdtempSync(join(tmpdir(), "b06-prior-400-"));
process.env.HOME = home;
for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]) {
  delete process.env[key];
}
const dir = join(home, ".tokenizer");
mkdirSync(dir);
writeFileSync(join(dir, "device.json"), JSON.stringify({ id: "device-a", name: "B06 probe" }));
writeFileSync(join(dir, "credentials.json"), JSON.stringify({ deviceToken: "synthetic" }));

const good: UsageEventInput = { source: "aider", sourceEventId: "good", occurredAt: "2026-10-08T00:00:00.000Z" };
const poison: UsageEventInput = { source: "aider", sourceEventId: "poison", occurredAt: "2026-10-08T00:00:00.000Z", model: "\ud800" };
const { readQueue, syncEvents } = await import("../../../src/cli/sync.ts");
const { writeQueue } = await import("../../../src/cli/collect.ts");
const { readRejectedUsageEvents } = await import("../../../src/cli/rejected-events.ts");
writeQueue([good, poison]);

let priorResponse: { code?: string; row?: number } | null = null;
let currentResponse: { code?: string; row?: number } | null = null;
let requests = 0;
const server = createServer(async (incoming, outgoing) => {
  requests += 1;
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  const input = () => new Request("http://localhost/batch", {
    method: "POST", headers: { "content-type": "application/json" }, body: raw
  });
  try { await readBoundedBatchJson(input()); }
  catch (error) { priorResponse = await invalidBatchResponse(error).json(); }
  try { await readBoundedBatchJson(input(), { locateInvalidUsageRow: true }); }
  catch (error) { currentResponse = await invalidBatchResponse(error).json(); }
  outgoing.statusCode = 400;
  outgoing.setHeader("content-type", "application/json");
  outgoing.end(JSON.stringify(priorResponse));
});

try {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const error = await syncEvents(
    { serverUrl: `http://127.0.0.1:${address.port}`, privacy: { mode: "sync", includePaths: [], excludePaths: [] } } as Parameters<typeof syncEvents>[0],
    readQueue(),
    { onBatchSynced: ({ remaining }) => writeQueue(remaining) }
  ).then(() => "unexpected success", (caught: Error) => caught.message);
  const observation = { priorResponse, currentResponse, error, requests,
    queueIds: readQueue().map((row) => row.sourceEventId), rejectedIds: readRejectedUsageEvents().map((row) => row.event.sourceEventId) };
  console.log(JSON.stringify(observation, null, 2));
  assert.deepEqual(priorResponse, { error: "invalid batch request", code: "invalid_json" });
  assert.deepEqual(currentResponse, { error: "invalid batch request", code: "invalid_json", row: 1 });
  assert.equal(error, "Sync failed: 400 invalid_json");
  assert.equal(requests, 1);
  assert.deepEqual(observation.queueIds, ["good", "poison"]);
  assert.deepEqual(observation.rejectedIds, []);
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(home, { recursive: true, force: true });
}
