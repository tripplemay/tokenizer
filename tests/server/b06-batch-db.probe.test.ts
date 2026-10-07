import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/server/db";
import { hashToken } from "../../src/server/tokens";

vi.mock("@/server/usage-cost-cache", () => ({ invalidateUsageCostCache: vi.fn() }));
vi.mock("@/server/pricing/trigger", () => ({ maybeTriggerPriceLookup: vi.fn() }));
import { POST as usage } from "../../app/api/usage/events/batch/route";
import { POST as quota } from "../../app/api/quota/snapshots/batch/route";

const url = process.env.EVAL_B06_DB_URL;
const suffix = randomUUID();
const user = `b06-user-${suffix}`;
const otherUser = `b06-other-${suffix}`;
const device = `b06-device-${suffix}`;
const otherDevice = `b06-other-device-${suffix}`;
const credential = `synthetic-b06-${suffix}`;
const tokenId = `b06-token-${suffix}`;
const event = { source: "aider", sourceEventId: `b06-${suffix}`, occurredAt: "2026-10-07T12:00:00.000Z", inputTokens: 2, outputTokens: 3 };
const snapshot = { provider: "codex-chatgpt", accountKey: "synthetic-account", windowKey: "plan", utilization: 0.25 };
function req(body: unknown, bearer = credential) {
  return new Request("http://localhost/batch", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` }, body: JSON.stringify(body) }) as never;
}
async function state() {
  return {
    user: await prisma.user.findUniqueOrThrow({ where: { id: user } }),
    device: await prisma.device.findUniqueOrThrow({ where: { id: device } }),
    token: await prisma.deviceToken.findUniqueOrThrow({ where: { id: tokenId } }),
    events: await prisma.usageEvent.count({ where: { userId: user } }),
    snapshots: await prisma.quotaSnapshot.count({ where: { userId: user } })
  };
}

describe.skipIf(!url)("B06 pre-write admission against an isolated real PG16", () => {
  beforeAll(async () => {
    if (process.env.DATABASE_URL !== url || !new URL(url!).pathname.endsWith("_scratch")) throw new Error("B06 requires matching explicit scratch database URLs");
    const version = await prisma.$queryRaw<Array<{ server_version: string }>>`SHOW server_version`;
    expect(version[0].server_version).toMatch(/^16\./);
    await prisma.user.createMany({ data: [{ id: user, email: `${suffix}@example.invalid`, timezone: "Asia/Shanghai" }, { id: otherUser, email: `other-${suffix}@example.invalid` }] });
    await prisma.device.createMany({ data: [{ id: device, userId: user, name: "before", lastSeenAt: new Date("2020-01-01T00:00:00Z") }, { id: otherDevice, userId: otherUser, name: "Other tenant" }] });
    await prisma.deviceToken.create({ data: { id: tokenId, userId: user, deviceId: device, tokenHash: hashToken(credential), prefix: "synthetic" } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [user, otherUser] } } });
    await prisma.$disconnect();
  });
  it("rejects mixed rows, malformed counts/dates and foreign devices without changing any persisted state", async () => {
    const before = await state();
    for (const poison of [{ ...event, source: "poison" }, { ...event, inputTokens: 2_147_483_648 }, { ...event, occurredAt: "2026-02-30T12:00:00Z" }]) {
      const response = await usage(req({ device: { id: device, name: "after" }, timezone: "UTC", events: [event, poison] }));
      expect(response.status).toBe(400);
      expect(await state()).toEqual(before);
    }
    const wrongDevice = await usage(req({ device: { id: otherDevice, name: "foreign" }, timezone: "UTC", events: [event] }));
    expect(wrongDevice.status).toBe(403);
    expect(await state()).toEqual(before);
    const poisonQuota = await quota(req({ snapshots: [snapshot, { ...snapshot, usedRaw: 0.5 }] }));
    expect(poisonQuota.status).toBe(400);
    expect(await state()).toEqual(before);
  });
  it("persists valid old wire payloads with Prisma Int/Decimal/BigInt types, minimizing usage content and binding tenants", async () => {
    expect((await usage(req({ userId: otherUser, device: { id: device, name: "Legacy Agent" }, timezone: "UTC", events: [{ ...event, inputTokens: 2_147_483_647, outputTokens: 0, costUsd: 9_999_999_999, rawJson: { assistant_text: "b06-private-content-canary" } }] }))).status).toBe(200);
    const stored = await prisma.usageEvent.findFirstOrThrow({ where: { userId: user, sourceEventId: event.sourceEventId } });
    expect(stored.inputTokens).toBe(2_147_483_647);
    expect(stored.totalTokens).toBe(2_147_483_647);
    expect(stored.costUsd?.toString()).toBe("9999999999");
    expect(stored.deviceId).toBe(device);
    expect(stored.rawJson).toBeNull();
    expect((await quota(req({ snapshots: [{ ...snapshot, userId: otherUser, capturedBy: otherDevice, usedRaw: Number.MAX_SAFE_INTEGER, limitRaw: null, rawJson: null }] }))).status).toBe(200);
    const storedQuota = await prisma.quotaSnapshot.findFirstOrThrow({ where: { userId: user } });
    expect(storedQuota.usedRaw).toBe(9007199254740991n);
    expect(storedQuota.utilization?.toString()).toBe("0.25");
    expect(storedQuota.capturedBy).toBe(device);
    expect(await prisma.usageEvent.count({ where: { userId: otherUser } })).toBe(0);
    expect(await prisma.quotaSnapshot.count({ where: { userId: otherUser } })).toBe(0);
  });
  it("leaves accepted state unchanged for a revoked or unknown credential", async () => {
    await prisma.deviceToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
    const before = await state();
    const body = { device: { id: device, name: "after revocation" }, timezone: "Asia/Tokyo", events: [event] };
    expect((await usage(req(body))).status).toBe(401);
    expect((await usage(req(body, "unknown-credential"))).status).toBe(401);
    expect(await state()).toEqual(before);
  });
});
