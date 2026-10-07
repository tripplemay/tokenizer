import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UsageEventInput } from "@/shared/usage";

const fixture = vi.hoisted(() => {
  const tmp = (process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp").replace(/[\\/]+$/, "");
  const home = `${tmp}/b07-pg-home-${process.pid}`;
  return {
    home,
    queuePath: `${home}/.tokenizer/queue.jsonl`,
    rejectedUsagePath: `${home}/.tokenizer/rejected-usage.jsonl`,
    statePath: `${home}/.tokenizer/state.json`,
    device: `b07-pg-device-${process.pid}`,
    credential: `synthetic-b07-pg-${process.pid}`,
    fetch: vi.fn()
  };
});

vi.mock("@/cli/config", () => ({
  queuePath: fixture.queuePath,
  rejectedUsagePath: fixture.rejectedUsagePath,
  statePath: fixture.statePath,
  readCredentials: () => ({ deviceToken: fixture.credential }),
  readDevice: () => ({ id: fixture.device, name: "B07 PG" })
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

const url = process.env.EVAL_B07_DB_URL;
const suffix = randomUUID();
const user = `b07-pg-user-${suffix}`;
const tokenId = `b07-pg-token-${suffix}`;
const event = (id: string): UsageEventInput => ({
  source: "aider", sourceEventId: `b07-${id}-${suffix}`,
  occurredAt: "2026-10-08T00:00:00.000Z", inputTokens: 2, outputTokens: 3
});

describe.skipIf(!url)("B07 exact queue ACK against isolated real PG16", () => {
  beforeAll(async () => {
    if (process.env.DATABASE_URL !== url || !new URL(url!).pathname.endsWith("_scratch")) {
      throw new Error("B07 requires matching explicit scratch database URLs");
    }
    const version = await prisma.$queryRaw<Array<{ server_version: string }>>`SHOW server_version`;
    expect(version[0].server_version).toMatch(/^16\./);
    await prisma.user.create({ data: { id: user, email: `${suffix}@example.invalid` } });
    await prisma.device.create({ data: { id: fixture.device, userId: user, name: "B07 PG" } });
    await prisma.deviceToken.create({
      data: { id: tokenId, userId: user, deviceId: fixture.device, tokenHash: hashToken(fixture.credential), prefix: "synthetic" }
    });
  });

  afterAll(async () => {
    rmSync(fixture.home, { recursive: true, force: true });
    await prisma.user.deleteMany({ where: { id: user } });
    await prisma.$disconnect();
  });

  it("retains a concurrent writer while committing good rows and quarantining poison", async () => {
    const good = event("good");
    const poison = { ...event("poison"), source: "unknown" } as unknown as UsageEventInput;
    writeQueue([good, poison]);
    let injected = false;
    fixture.fetch.mockImplementation(async (input: string, init: RequestInit) => {
      if (!injected) {
        injected = true;
        const tsx = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
        execFileSync(process.execPath, [tsx, "tests/cli/b07-queue-multiwriter.probe.ts", "collect"], {
          env: { ...process.env, HOME: fixture.home, USERPROFILE: fixture.home },
          stdio: "pipe"
        });
      }
      return POST(new Request(input, init) as never);
    });

    const result = await syncEvents(
      { serverUrl: "http://localhost", privacy: { mode: "sync", includePaths: [], excludePaths: [] } } as Parameters<typeof syncEvents>[0],
      [good, poison]
    );

    expect(result).toMatchObject({ inserted: 1, received: 1, rejected: 1 });
    expect(readQueue().map((row) => row.sourceEventId)).toEqual(["newly-collected"]);
    expect(readRejectedUsageEvents().map((row) => row.event.sourceEventId)).toEqual([poison.sourceEventId]);
    expect(await prisma.usageEvent.findMany({ where: { userId: user }, select: { sourceEventId: true } }))
      .toEqual([{ sourceEventId: good.sourceEventId }]);
  });
});
