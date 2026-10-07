import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestUsageEvents } from "@/server/ingest";
import { prisma } from "@/server/db";
import type { UsageEventInput } from "@/shared/usage";

const DB_URL = process.env.EVAL_R02_DB_URL;
const suffix = randomUUID();
const users = [0, 1].map((index) => ({
  id: `r02-user-${index}-${suffix}`,
  email: `r02-${index}-${suffix}@example.invalid`,
  deviceId: `r02-device-${index}-${suffix}`,
  tokenId: `r02-token-${index}-${suffix}`
}));

describe.skipIf(!DB_URL)("Git privacy against isolated PostgreSQL", () => {
  beforeAll(async () => {
    if (process.env.DATABASE_URL !== DB_URL) throw new Error("DATABASE_URL must match EVAL_R02_DB_URL");
    const url = new URL(DB_URL!);
    if (!(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname.startsWith("/scratch_"))) {
      throw new Error("R02 database probe requires a loopback scratch_* database");
    }

    for (const user of users) {
      await prisma.user.create({ data: { id: user.id, email: user.email } });
      await prisma.device.create({ data: { id: user.deviceId, userId: user.id, name: "R02 synthetic device" } });
      await prisma.deviceToken.create({
        data: { id: user.tokenId, userId: user.id, deviceId: user.deviceId, tokenHash: `r02-${user.tokenId}`, prefix: "r02" }
      });
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
    await prisma.$disconnect();
  });

  it("stores one project per tenant and no synthetic remote credentials", async () => {
    for (const [index, user] of users.entries()) {
      const event: UsageEventInput = {
        source: "claude-code",
        sourceEventId: `r02-${index}-${suffix}`,
        occurredAt: "2026-10-07T00:00:00.000Z",
        workspacePath: `/synthetic/r02/${index}/Repo`,
        repoKey: `reader:FAKE_TOKEN_${index}@git.example/Team/Repo`,
        gitRemote: `https://reader:FAKE_TOKEN_${index}@git.example/Team/Repo.git?key=FAKE_QUERY_${index}`,
        inputTokens: 1,
        outputTokens: 1
      };
      const result = await ingestUsageEvents([event], { id: user.deviceId, name: "R02 synthetic device" }, user.tokenId, user.id);
      expect(result.inserted).toBe(1);
    }

    const projects = await prisma.project.findMany({
      where: { userId: { in: users.map((user) => user.id) } },
      orderBy: { userId: "asc" }
    });
    const events = await prisma.usageEvent.findMany({
      where: { userId: { in: users.map((user) => user.id) } },
      orderBy: { userId: "asc" }
    });
    expect(projects).toHaveLength(2);
    expect(events).toHaveLength(2);
    expect(new Set(projects.map((project) => project.id)).size).toBe(2);
    expect(projects.every((project) => project.repoKey === "git.example/Team/Repo")).toBe(true);
    expect(events.every((event) => event.repoKey === "git.example/Team/Repo")).toBe(true);
    for (const event of events) {
      expect(projects.find((project) => project.id === event.projectId)?.userId).toBe(event.userId);
    }
    expect(JSON.stringify({ projects, events })).not.toMatch(/FAKE_TOKEN|FAKE_QUERY/);
  });
});
