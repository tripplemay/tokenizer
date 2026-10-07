import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UsageEventInput } from "@/shared/usage";

const fixture = vi.hoisted(() => {
  const tmp = (process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp").replace(/[\\/]+$/, "");
  return {
    queuePath: `${tmp}/b06-partial-pg-queue-${process.pid}.jsonl`,
    rejectedUsagePath: `${tmp}/b06-partial-pg-rejected-${process.pid}.jsonl`,
    statePath: `${tmp}/b06-partial-pg-state-${process.pid}.json`,
    device: `b06-partial-device-${process.pid}`,
    credential: `synthetic-b06-partial-${process.pid}`,
    fetch: vi.fn()
  };
});
vi.mock("@/cli/config", () => ({
  queuePath: fixture.queuePath,
  rejectedUsagePath: fixture.rejectedUsagePath,
  statePath: fixture.statePath,
  readCredentials: () => ({ deviceToken: fixture.credential }),
  readDevice: () => ({ id: fixture.device, name: "B06 partial PG" })
}));
vi.mock("@/cli/fetch", () => ({ agentFetch: fixture.fetch }));
vi.mock("@/cli/agent-version", () => ({ getAgentVersion: () => "test" }));
vi.mock("@/server/usage-cost-cache", () => ({ invalidateUsageCostCache: vi.fn() }));
vi.mock("@/server/pricing/trigger", () => ({ maybeTriggerPriceLookup: vi.fn() }));

import { writeQueue } from "@/cli/collect";
import { readRejectedUsageEvents } from "@/cli/rejected-events";
import { readQueue, syncEvents } from "@/cli/sync";
import { POST } from "../../app/api/usage/events/batch/route";
import { prisma } from "../../src/server/db";
import { hashToken } from "../../src/server/tokens";

const url = process.env.EVAL_B06_DB_URL;
const suffix = randomUUID();
const user = `b06-partial-user-${suffix}`;
const device = fixture.device;
const credential = fixture.credential;
const tokenId = `b06-partial-token-${suffix}`;
const event = (id: string): UsageEventInput => ({
  source: "aider",
  sourceEventId: `b06-partial-${id}-${suffix}`,
  occurredAt: "2026-10-08T00:00:00.000Z",
  inputTokens: 2,
  outputTokens: 3
});

describe.skipIf(!url)("B06 client partial ACK against isolated real PG16", () => {
  beforeAll(async () => {
    if (process.env.DATABASE_URL !== url || !new URL(url!).pathname.endsWith("_scratch")) {
      throw new Error("B06 requires matching explicit scratch database URLs");
    }
    const version = await prisma.$queryRaw<Array<{ server_version: string }>>`SHOW server_version`;
    expect(version[0].server_version).toMatch(/^16\./);
    await prisma.user.create({ data: { id: user, email: `${suffix}@example.invalid` } });
    await prisma.device.create({ data: { id: device, userId: user, name: "B06 partial PG" } });
    await prisma.deviceToken.create({
      data: { id: tokenId, userId: user, deviceId: device, tokenHash: hashToken(credential), prefix: "synthetic" }
    });
    fixture.fetch.mockImplementation(async (input: string, init: RequestInit) => {
      return POST(new Request(input, init) as never);
    });
  });

  afterAll(async () => {
    for (const path of [fixture.queuePath, fixture.rejectedUsagePath, fixture.statePath]) rmSync(path, { force: true });
    await prisma.user.deleteMany({ where: { id: user } });
    await prisma.$disconnect();
  });

  it("persists good neighbours once, quarantines poison durably and drains the active queue", async () => {
    const goodA = event("good-a");
    const poison = { ...event("poison"), source: "unknown" } as unknown as UsageEventInput;
    const goodB = event("good-b");
    writeQueue([goodA, poison, goodB]);

    const result = await syncEvents(
      { serverUrl: "http://localhost", privacy: { mode: "sync", includePaths: [], excludePaths: [] } } as Parameters<typeof syncEvents>[0],
      readQueue(),
      { onBatchSynced: ({ remaining }) => writeQueue(remaining) }
    );

    expect(result).toMatchObject({ inserted: 2, received: 2, rejected: 1 });
    expect(readQueue()).toEqual([]);
    expect(readRejectedUsageEvents().map((row) => row.event.sourceEventId)).toEqual([poison.sourceEventId]);
    expect(await prisma.usageEvent.findMany({
      where: { userId: user },
      select: { sourceEventId: true },
      orderBy: { sourceEventId: "asc" }
    })).toEqual([
      { sourceEventId: goodA.sourceEventId },
      { sourceEventId: goodB.sourceEventId }
    ]);

    // Replaying the same local snapshot is idempotent: accepted rows are DB
    // duplicates and the quarantine identity is not appended a second time.
    const replay = await syncEvents(
      { serverUrl: "http://localhost", privacy: { mode: "sync", includePaths: [], excludePaths: [] } } as Parameters<typeof syncEvents>[0],
      [goodA, poison, goodB]
    );
    expect(replay).toMatchObject({ inserted: 0, duplicates: 2, received: 2, rejected: 1 });
    expect(readRejectedUsageEvents()).toHaveLength(1);
    expect(await prisma.usageEvent.count({ where: { userId: user } })).toBe(2);
  });
});
