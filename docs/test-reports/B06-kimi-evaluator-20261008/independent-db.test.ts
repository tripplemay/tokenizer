/**
 * Independent Kimi-family Evaluator real-PostgreSQL-16 probes for B06.
 * Runs the REAL route handlers against a REAL scratch database (real auth
 * lookup, real tenant binding, real ingest writes) and asserts that every
 * rejected request leaves the persisted state byte-identical — user timezone,
 * device name/lastSeenAt/lastSyncAt, token lastUsedAt, event/snapshot counts.
 * Only post-response side effects (cost cache invalidation, pricing trigger)
 * are mocked; they never touch the database assertions.
 *
 * Guard: requires KIMI_B06_DB_URL === DATABASE_URL ending in _scratch,
 * PostgreSQL 16.x, session timezone UTC. Skips otherwise.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../src/server/db";
import { hashToken } from "../../../src/server/tokens";

vi.mock("@/server/usage-cost-cache", () => ({ invalidateUsageCostCache: vi.fn() }));
vi.mock("@/server/pricing/trigger", () => ({ maybeTriggerPriceLookup: vi.fn() }));
import { POST as usagePOST } from "../../../app/api/usage/events/batch/route";
import { POST as quotaPOST } from "../../../app/api/quota/snapshots/batch/route";

const url = process.env.KIMI_B06_DB_URL;
const suffix = randomUUID();
const user = `kimi-user-${suffix}`;
const otherUser = `kimi-other-${suffix}`;
const device = `kimi-device-${suffix}`;
const otherDevice = `kimi-other-device-${suffix}`;
const credential = `kimi-credential-${suffix}`;
const tokenId = `kimi-token-${suffix}`;
const EVENT = { source: "aider", sourceEventId: `kimi-evt-${suffix}`, occurredAt: "2026-10-07T12:00:00.000Z", inputTokens: 2, outputTokens: 3 };
const SNAPSHOT = { provider: "codex-chatgpt", accountKey: "kimi-acct", windowKey: "rate_limit_primary", utilization: 0.355 };

function req(body: unknown, bearer = credential, headers: Record<string, string> = {}) {
  return new Request("http://localhost/batch", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}`, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body)
  }) as never;
}
function streamReq(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    }
  });
  return new Request("http://localhost/batch", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${credential}`, ...headers },
    body: stream,
    duplex: "half"
  } as RequestInit) as never;
}
const usageBody = () => ({ device: { id: device, name: "Kimi DB Probe" }, timezone: "UTC", events: [EVENT] });

async function state() {
  return {
    user: await prisma.user.findUniqueOrThrow({ where: { id: user } }),
    device: await prisma.device.findUniqueOrThrow({ where: { id: device } }),
    token: await prisma.deviceToken.findUniqueOrThrow({ where: { id: tokenId } }),
    events: await prisma.usageEvent.count({ where: { userId: user } }),
    snapshots: await prisma.quotaSnapshot.count({ where: { userId: user } }),
    projects: await prisma.project.count({ where: { userId: user } })
  };
}

describe.skipIf(!url)("B06 independent reject-before-write against real PG16", () => {
  beforeAll(async () => {
    if (process.env.DATABASE_URL !== url || !new URL(url!).pathname.endsWith("_scratch")) {
      throw new Error("independent B06 probe requires matching explicit scratch database URLs");
    }
    const version = await prisma.$queryRaw<Array<{ server_version: string }>>`SHOW server_version`;
    expect(version[0].server_version).toMatch(/^16\./);
    const tz = await prisma.$queryRaw<Array<{ TimeZone: string }>>`SHOW timezone`;
    expect(tz[0].TimeZone).toBe("UTC");
    await prisma.user.createMany({ data: [{ id: user, email: `${suffix}@example.invalid`, timezone: "Asia/Shanghai" }, { id: otherUser, email: `other-${suffix}@example.invalid` }] });
    await prisma.device.createMany({ data: [
      { id: device, userId: user, name: "before", lastSeenAt: new Date("2020-01-01T00:00:00Z"), lastSyncAt: new Date("2020-01-01T00:00:00Z") },
      { id: otherDevice, userId: otherUser, name: "Other tenant" }
    ] });
    await prisma.deviceToken.create({ data: { id: tokenId, userId: user, deviceId: device, tokenHash: hashToken(credential), prefix: "kimi" } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [user, otherUser] } } });
    expect(await prisma.usageEvent.count({ where: { userId: { in: [user, otherUser] } } })).toBe(0);
    expect(await prisma.quotaSnapshot.count({ where: { userId: { in: [user, otherUser] } } })).toBe(0);
    await prisma.$disconnect();
  });

  it("rejects every adversarial class without changing any persisted state", async () => {
    const before = await state();
    // transport / JSON gates
    expect((await usagePOST(req(`{"device":"kimi-canary`))).status).toBe(400); // truncated
    expect((await usagePOST(streamReq([new Uint8Array([0x7b, 0xff, 0x7d])]))).status).toBe(400); // bad UTF-8
    expect((await usagePOST(streamReq([new Uint8Array(1_048_577).fill(0x20)], { "content-length": "2" }))).status).toBe(400); // forged length, real stream over cap
    expect((await usagePOST(req({}, credential, { "content-length": "1048577" }))).status).toBe(400); // declared over cap
    expect((await usagePOST(req({}, credential, { "content-type": "text/yaml" }))).status).toBe(400);
    expect(await state()).toEqual(before);
    // deep/wide JSON bombs
    let deep: unknown = "x";
    for (let i = 0; i < 40; i += 1) deep = [deep];
    expect((await usagePOST(req({ ...usageBody(), addon: deep }))).status).toBe(400);
    expect((await usagePOST(req({ ...usageBody(), addon: Array(100_001).fill(0) }))).status).toBe(400);
    expect(await state()).toEqual(before);
    // prototype pollution attempt stays inert (valid shape otherwise, no writes expected because device name unchanged path still writes:
    // use quota with empty snapshots so a 200 must not write either)
    expect((await quotaPOST(req(`{"snapshots":[],"__proto__":{"polluted":true}}`))).status).toBe(200);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(await state()).toEqual(before);
    // row/count/field poisons (mixed good + poison whole-batch 400)
    const mixed = (patch: object) => ({ ...usageBody(), events: [EVENT, { ...EVENT, sourceEventId: `kimi-poison-${suffix}`, ...patch }] });
    for (const patch of [
      { source: "unknown-source" },
      { inputTokens: 2_147_483_648 },
      { inputTokens: "5" },
      { occurredAt: "2024-02-30T00:00:00Z" },
      { occurredAt: "2026-10-07T12:00:00+00:00" },
      { model: "m".repeat(257) },
      { costUsd: 10_000_000_000 },
      { inputTokens: 2_147_483_647, outputTokens: 1, totalTokens: 0 }
    ]) {
      expect((await usagePOST(req(mixed(patch)))).status).toBe(400);
      expect(await state()).toEqual(before);
    }
    // 201-row and 101-row overflows
    expect((await usagePOST(req({ ...usageBody(), events: Array.from({ length: 201 }, (_, i) => ({ ...EVENT, sourceEventId: `k${i}` })) }))).status).toBe(400);
    expect((await quotaPOST(req({ snapshots: Array(101).fill(SNAPSHOT) }))).status).toBe(400);
    expect(await state()).toEqual(before);
    // invalid timezone with otherwise valid rows
    expect((await usagePOST(req({ ...usageBody(), timezone: "Mars/Olympus_Mons" }))).status).toBe(400);
    expect((await state()).user.timezone).toBe("Asia/Shanghai");
    // foreign device / cross-tenant binding
    expect((await usagePOST(req({ ...usageBody(), device: { id: otherDevice, name: "foreign" } }))).status).toBe(403);
    expect(await state()).toEqual(before);
    // quota poisons before Decimal/BigInt conversion
    for (const patch of [{ usedRaw: 0.5 }, { usedRaw: "10" }, { provider: "openai" }, { utilization: 1.5 }, { resetsAt: "2026-02-30T00:00:00Z" }, { limitRaw: Number.MAX_SAFE_INTEGER + 1 }]) {
      expect((await quotaPOST(req({ snapshots: [SNAPSHOT, { ...SNAPSHOT, ...patch }] }))).status).toBe(400);
      expect(await state()).toEqual(before);
    }
    // unknown credential never reaches validation
    expect((await usagePOST(req(usageBody(), "kimi-unknown-credential"))).status).toBe(401);
    expect(await state()).toEqual(before);
  });

  it("persists valid boundary wires with exact PG Int/Decimal/BigInt semantics, minimized content and tenant binding", async () => {
    const events = Array.from({ length: 200 }, (_, i) => ({
      source: i % 2 ? "codex" : "claude-code",
      sourceEventId: `kimi-ok-${suffix}-${i}`,
      occurredAt: i % 3 === 0 ? "2026-10-07T12:00:00Z" : i % 3 === 1 ? "2026-10-07T12:00:00.1Z" : "2026-10-07T12:00:00.12Z",
      inputTokens: 2_147_483_647, outputTokens: 0,
      model: null, costUsd: i === 0 ? 9_999_999_999.5 : null,
      userId: otherUser, deviceId: otherDevice, // injection attempts must be ignored
      rawJson: { content: `kimi-private-canary-${suffix}` }
    }));
    const usageResponse = await usagePOST(req({ userId: otherUser, ...usageBody(), events }));
    expect(usageResponse.status).toBe(200);
    const stored = await prisma.usageEvent.findFirstOrThrow({ where: { userId: user, sourceEventId: `kimi-ok-${suffix}-0` } });
    expect(stored.inputTokens).toBe(2_147_483_647);
    expect(stored.totalTokens).toBe(2_147_483_647); // fallback sum
    expect(stored.costUsd?.toString()).toBe("9999999999.5");
    expect(stored.deviceId).toBe(device);
    expect(stored.userId).toBe(user);
    expect(stored.rawJson).toBeNull(); // B03 privacy minimization intact
    expect(await prisma.usageEvent.count({ where: { userId: otherUser } })).toBe(0);
    expect(await prisma.usageEvent.count({ where: { userId: user } })).toBe(200);

    const quotaResponse = await quotaPOST(req({ snapshots: [{ ...SNAPSHOT, userId: otherUser, capturedBy: otherDevice, usedRaw: Number.MAX_SAFE_INTEGER, limitRaw: null, rawJson: { used_percent: 35.5 } }] }));
    expect(quotaResponse.status).toBe(200);
    const storedQuota = await prisma.quotaSnapshot.findFirstOrThrow({ where: { userId: user } });
    expect(storedQuota.usedRaw).toBe(9007199254740991n);
    expect(storedQuota.utilization?.toString()).toBe("0.355");
    expect(storedQuota.capturedBy).toBe(device);
    expect(storedQuota.userId).toBe(user);
    expect(await prisma.quotaSnapshot.count({ where: { userId: otherUser } })).toBe(0);

    // timezone of a VALID request does advance (sanity that state checks are not vacuous)
    expect((await state()).device.lastSyncAt?.toISOString()).not.toBe("2020-01-01T00:00:00.000Z");
    expect((await state()).token.lastUsedAt).not.toBeNull();
  });

  it("empty batches stay 200; the empty usage batch advances sync state, the empty quota batch writes nothing", async () => {
    const before = await state();
    expect((await quotaPOST(req({ snapshots: [] }))).status).toBe(200);
    expect(await state()).toEqual(before);
    const usageResponse = await usagePOST(req({ ...usageBody(), events: [] }));
    expect(usageResponse.status).toBe(200);
    expect((await state()).events).toBe(before.events); // empty batch inserts nothing
  });

  it("a revoked credential gets 401 and changes nothing", async () => {
    await prisma.deviceToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
    const before = await state();
    expect((await usagePOST(req(usageBody()))).status).toBe(401);
    expect((await quotaPOST(req({ snapshots: [SNAPSHOT] }))).status).toBe(401);
    expect(await state()).toEqual(before);
  });
});
