import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UsageEventInput } from "../../../src/shared/usage";

const url = process.env.EVAL_B06_DB_URL;
if (!url || process.env.DATABASE_URL !== url || !new URL(url).pathname.endsWith("_scratch")) {
  throw new Error("Matching DATABASE_URL/EVAL_B06_DB_URL scratch URLs are required");
}
const home = mkdtempSync(join(tmpdir(), "b06-pg-http-"));
process.env.HOME = home;
for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]) {
  delete process.env[key];
}
const dir = join(home, ".tokenizer");
mkdirSync(dir);
const suffix = randomUUID();
const userId = `b06-prereview-user-${suffix}`;
const deviceId = `b06-prereview-device-${suffix}`;
const secret = `b06-prereview-secret-${suffix}`;
writeFileSync(join(dir, "device.json"), JSON.stringify({ id: deviceId, name: "B06 PG HTTP probe" }));
writeFileSync(join(dir, "credentials.json"), JSON.stringify({ deviceToken: secret }));

const { prisma } = await import("../../../src/server/db.ts");
const { hashToken } = await import("../../../src/server/tokens.ts");
const { POST } = await import("../../../app/api/usage/events/batch/route.ts");
const { readQueue, syncEvents } = await import("../../../src/cli/sync.ts");
const { writeQueue } = await import("../../../src/cli/collect.ts");
const { readRejectedUsageEvents } = await import("../../../src/cli/rejected-events.ts");
const event = (id: string): UsageEventInput => ({
  source: "aider", sourceEventId: `${id}-${suffix}`,
  occurredAt: "2026-10-08T00:00:00.000Z", inputTokens: 2
});
const goodA = event("good-a");
const poison = { ...event("poison"), inputTokens: -1 };
const goodB = event("good-b");
const statuses: number[] = [];
const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk as Buffer);
    const request = new Request("http://localhost/api/usage/events/batch", {
      method: "POST",
      headers: {
        "content-type": incoming.headers["content-type"] ?? "",
        authorization: incoming.headers.authorization ?? "",
        "x-tokenizer-batch-protocol": incoming.headers["x-tokenizer-batch-protocol"] ?? ""
      },
      body: Buffer.concat(chunks)
    });
    const response = await POST(request as never);
    statuses.push(response.status);
    outgoing.statusCode = response.status;
    outgoing.setHeader("content-type", "application/json");
    outgoing.end(await response.text());
  } catch (error) {
    outgoing.statusCode = 500;
    outgoing.end(String(error));
  }
});

try {
  const version = await prisma.$queryRaw<Array<{ server_version: string }>>`SHOW server_version`;
  const timezone = await prisma.$queryRaw<Array<{ TimeZone: string }>>`SHOW TimeZone`;
  assert.match(version[0].server_version, /^16\./);
  assert.equal(timezone[0].TimeZone, "UTC");
  await prisma.user.create({ data: { id: userId, email: `${suffix}@example.invalid` } });
  await prisma.device.create({ data: { id: deviceId, userId, name: "B06 PG HTTP probe" } });
  await prisma.deviceToken.create({ data: {
    id: `b06-prereview-token-${suffix}`, userId, deviceId,
    tokenHash: hashToken(secret), prefix: "synthetic"
  } });
  writeQueue([goodA, poison, goodB]);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const config = { serverUrl: `http://127.0.0.1:${address.port}`,
    privacy: { mode: "sync", includePaths: [], excludePaths: [] } } as Parameters<typeof syncEvents>[0];
  const first = await syncEvents(config, readQueue(), { onBatchSynced: ({ remaining }) => writeQueue(remaining) });
  const replay = await syncEvents(config, [goodA, poison, goodB]);
  const state = async () => ({
    user: await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
    device: await prisma.device.findUnique({ where: { id: deviceId }, select: { lastSeenAt: true, lastSyncAt: true } }),
    token: await prisma.deviceToken.findUnique({ where: { tokenHash: hashToken(secret) }, select: { lastUsedAt: true } }),
    events: await prisma.usageEvent.count({ where: { userId } }),
    projects: await prisma.project.count({ where: { userId } })
  });
  const beforeRejectOnly = await state();
  const rejectedOnlyHttp = await fetch(`${config.serverUrl}/api/usage/events/batch`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}`,
      "x-tokenizer-batch-protocol": "usage-partial-v1" },
    body: JSON.stringify({ device: { id: deviceId, name: "B06 PG HTTP probe" },
      timezone: "Asia/Tokyo", events: [poison] })
  });
  const rejectedOnly = await rejectedOnlyHttp.json();
  const afterRejectOnly = await state();
  const rows = await prisma.usageEvent.findMany({ where: { userId }, select: { sourceEventId: true }, orderBy: { sourceEventId: "asc" } });
  const observation = { version: version[0].server_version, timezone: timezone[0].TimeZone, statuses,
    first, replay, rejectedOnly, rejectOnlyWriteFree: JSON.stringify(beforeRejectOnly) === JSON.stringify(afterRejectOnly),
    rows, queueIds: readQueue().map((row) => row.sourceEventId),
    rejectedIds: readRejectedUsageEvents().map((row) => row.event.sourceEventId) };
  console.log(JSON.stringify(observation, null, 2));
  assert.deepEqual(statuses, [200, 200, 200]);
  assert.equal(first.received, 2);
  assert.equal(first.rejected, 1);
  assert.equal(replay.duplicates, 2);
  assert.deepEqual(rejectedOnly, { inserted: 0, updated: 0, duplicates: 0, received: 0,
    deviceId, newModelKeys: [], protocol: "usage-partial-v1", accepted: [],
    rejected: [{ row: 0, code: "invalid_event" }] });
  assert.equal(observation.rejectOnlyWriteFree, true);
  assert.deepEqual(observation.queueIds, []);
  assert.deepEqual(observation.rejectedIds, [poison.sourceEventId]);
  assert.deepEqual(rows.map((row) => row.sourceEventId), [goodA.sourceEventId, goodB.sourceEventId]);
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
  rmSync(home, { recursive: true, force: true });
}
