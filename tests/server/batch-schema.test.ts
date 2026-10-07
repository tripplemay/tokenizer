import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_BATCH_BODY_BYTES, MAX_RAW_JSON_BYTES, MAX_USAGE_INT, validateUsageBatch } from "../../src/server/batch-input";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), timezone: vi.fn(), cache: vi.fn(), price: vi.fn(), detect: vi.fn(),
  prisma: {
    device: { upsert: vi.fn() }, deviceToken: { update: vi.fn() },
    project: { findFirst: vi.fn(), create: vi.fn() },
    usageEvent: { createMany: vi.fn() }, quotaSnapshot: { createMany: vi.fn() }
  }
}));
vi.mock("@/server/auth", () => ({
  authenticateDeviceToken: mocks.auth,
  unauthorized: () => Response.json({ error: "unauthorized" }, { status: 401 }),
  forbidden: () => Response.json({ error: "forbidden" }, { status: 403 })
}));
vi.mock("@/server/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/server/timezone", () => ({ updateUserTimezoneIfValid: mocks.timezone }));
vi.mock("@/server/usage-cost-cache", () => ({ invalidateUsageCostCache: mocks.cache }));
vi.mock("@/server/pricing/trigger", () => ({ maybeTriggerPriceLookup: mocks.price }));
vi.mock("@/server/pricing/detect", () => ({ detectAndTrackUnpricedModels: mocks.detect }));
import { POST as usage } from "../../app/api/usage/events/batch/route";
import { POST as quota } from "../../app/api/quota/snapshots/batch/route";

const token = { id: "token-a", userId: "tenant-a", deviceId: "device-a", device: { id: "device-a", userId: "tenant-a" } };
const event = { source: "aider", sourceEventId: "event-a", occurredAt: "2026-10-07T12:00:00.000Z", inputTokens: 2, outputTokens: 3 };
const snapshot = { provider: "codex-chatgpt", accountKey: "account-a", windowKey: "rate_limit_primary", utilization: 0.83, unit: "percent", resetsAt: "2026-09-19T12:21:47.000Z", rawJson: { used_percent: 83, limit_window_seconds: 604800 } };
const usageBody = () => ({ device: { id: "device-a", name: "Legacy Agent" }, timezone: "UTC", events: [event] });
const quotaBody = () => ({ snapshots: [snapshot] });
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/batch", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }) as never;
}
function noEffects() {
  for (const fn of [mocks.timezone, mocks.cache, mocks.price, mocks.detect, mocks.prisma.device.upsert, mocks.prisma.deviceToken.update, mocks.prisma.project.findFirst, mocks.prisma.project.create, mocks.prisma.usageEvent.createMany, mocks.prisma.quotaSnapshot.createMany]) expect(fn).not.toHaveBeenCalled();
}
async function bad(handler: typeof usage, body: unknown, code: string) {
  const response = await handler(request(body));
  expect(response.status).toBe(400);
  const result = await response.json();
  expect(result.code).toBe(code);
  expect(result.error).toBe("invalid batch request");
  expect(JSON.stringify(result)).not.toContain("secret-canary");
  noEffects();
}
function nested(levels: number): unknown {
  let value: unknown = "secret-canary";
  for (let depth = 0; depth < levels; depth += 1) value = { value };
  return value;
}

describe("B06 bounded pre-side-effect batch admission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(token);
    mocks.prisma.device.upsert.mockResolvedValue({ id: "device-a" });
    mocks.prisma.project.findFirst.mockResolvedValue(null);
    mocks.prisma.project.create.mockResolvedValue({ id: "project-a" });
    mocks.prisma.usageEvent.createMany.mockImplementation(({ data }) => Promise.resolve({ count: data.length }));
    mocks.prisma.quotaSnapshot.createMany.mockImplementation(({ data }) => Promise.resolve({ count: data.length }));
    mocks.detect.mockResolvedValue([]);
  });
  it.each([usage, quota])("authenticates before consuming any body", async (handler) => {
    mocks.auth.mockResolvedValue(null);
    const req = request("secret-canary");
    expect((await handler(req)).status).toBe(401);
    expect((req as Request).bodyUsed).toBe(false);
    noEffects();
  });
  it.each([usage, quota])("rejects a token bound to another tenant before consuming any body", async (handler) => {
    mocks.auth.mockResolvedValue({ ...token, device: { id: token.deviceId, userId: "tenant-b" } });
    const req = request("secret-canary");
    expect((await handler(req)).status).toBe(403);
    expect((req as Request).bodyUsed).toBe(false);
    noEffects();
  });
  it.each([usage, quota])("rejects an explicit different device without writes", async (handler) => {
    const body = handler === usage ? usageBody() : quotaBody();
    expect((await handler(request({ ...body, device: { id: "device-b", name: "Other" } }))).status).toBe(403);
    noEffects();
  });
  it.each([null, [], {}, { events: null }, { events: [null], device: { id: "device-a", name: "Agent" } }])("rejects malformed usage envelope %j", async (body) => {
    await bad(usage, body, body && "events" in body && Array.isArray(body.events) ? "invalid_event" : "invalid_batch");
  });
  it.each([null, [], {}, { snapshots: null }, { snapshots: [null] }])("rejects malformed quota envelope %j", async (body) => {
    await bad(quota, body, body && "snapshots" in body && Array.isArray(body.snapshots) ? "invalid_snapshot" : "invalid_batch");
  });
  it.each([
    ["source", "secret-canary"], ["sourceEventId", ""], ["sourceEventId", 7], ["model", {}],
    ["inputTokens", -1], ["outputTokens", 0.5], ["cachedInputTokens", "2"], ["cacheWriteTokens", null],
    ["totalTokens", MAX_USAGE_INT + 1], ["inputTokens", Number.MAX_SAFE_INTEGER + 1],
    ["costUsd", -1], ["costUsd", 10_000_000_000], ["costUsd", "1.25"],
    ["occurredAt", "2026-02-30T12:00:00Z"], ["occurredAt", "2026-10-07T12:00:00+00:00"],
    ["occurredAt", "2026-10-07"], ["occurredAt", "2026-10-07T24:00:00Z"],
    ["gitRemote", "x".repeat(4097)], ["sessionId", "secret-canary\u0000"], ["model", "\ud800"]
  ])("rejects mixed good/poison usage rows for %s=%j without a partial ACK", async (field, value) => {
    const response = await usage(request({ ...usageBody(), events: [event, { ...event, [field as string]: value }] }));
    expect(response.status).toBe(400);
    const result = await response.json();
    expect(result.code).toBe(typeof value === "string" && (value.includes("\u0000") || value === "\ud800") ? "invalid_json" : "invalid_event");
    expect(result.row).toBe(result.code === "invalid_json" ? undefined : 1);
    noEffects();
  });
  it.each([
    ["provider", "unknown"], ["accountKey", ""], ["windowKey", {}], ["unit", 4],
    ["usedRaw", -1], ["usedRaw", 1.1], ["usedRaw", "10"], ["limitRaw", Number.MAX_SAFE_INTEGER + 1],
    ["utilization", -0.1], ["utilization", 1.0001], ["utilization", "0.5"],
    ["resetsAt", "2026-02-29T12:00:00Z"], ["resetsAt", "not-a-date"]
  ])("rejects mixed good/poison quota rows for %s=%j before Decimal/BigInt writes", async (field, value) => {
    await bad(quota, { snapshots: [snapshot, { ...snapshot, [field as string]: value }] }, "invalid_snapshot");
  });
  it("rejects fallback token-sum overflow, diagnostics coercion and invalid timezone", async () => {
    await bad(usage, { ...usageBody(), events: [{ ...event, inputTokens: MAX_USAGE_INT, totalTokens: 0 }] }, "invalid_event");
    await bad(usage, { ...usageBody(), device: { ...usageBody().device, diagnostics: { agentFeatureVersion: "9" } } }, "invalid_device");
    await bad(usage, { ...usageBody(), timezone: "secret-canary" }, "invalid_timezone");
  });
  it.each([usage, quota])("bounds raw JSON depth and bytes before any write", async (handler) => {
    const rows = handler === usage ? "events" : "snapshots";
    const base = handler === usage ? usageBody() : quotaBody();
    const row = handler === usage ? event : snapshot;
    await bad(handler, { ...base, [rows]: [{ ...row, rawJson: nested(9) }] }, "invalid_raw_json");
    await bad(handler, { ...base, [rows]: [{ ...row, rawJson: "x".repeat(MAX_RAW_JSON_BYTES) }] }, "invalid_raw_json");
  });
  it("rejects unsafe Codex cumulative identity counters and unbounded device metadata", async () => {
    await bad(usage, { ...usageBody(), events: [{ ...event, source: "codex", rawJson: { payload: { info: { total_token_usage: { total_tokens: Number.MAX_SAFE_INTEGER + 1 } } } } }] }, "invalid_event");
    await bad(usage, { ...usageBody(), device: { ...usageBody().device, metadata: nested(9) } }, "invalid_raw_json");
  });
  it("rejects batch count overflow, including quota requests that omit device", async () => {
    await bad(usage, { ...usageBody(), events: Array(201).fill(event) }, "batch_too_large");
    await bad(quota, { snapshots: Array(101).fill(snapshot) }, "batch_too_large");
  });
  it.each([usage, quota])("returns safe 400 for malformed, nonfinite JSON, bad UTF8 and wrong media type", async (handler) => {
    for (const bytes of ["{secret-canary", '{"secret-canary":1e400}', new Uint8Array([0xff])]) {
      const req = new Request("http://localhost/batch", { method: "POST", headers: { "content-type": "application/json" }, body: bytes }) as never;
      const response = await handler(req);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid batch request", code: "invalid_json" });
      noEffects();
    }
    await bad(handler, nested(33), "invalid_json");
    expect((await handler(request({}, { "content-type": "text/plain" }))).status).toBe(400);
    noEffects();
  });
  it.each([usage, quota])("caps the real stream before parsing even with forged Content-Length", async (handler) => {
    for (const length of [undefined, "1"]) {
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(MAX_BATCH_BODY_BYTES + 1).fill(0x20)); },
        cancel() { cancelled = true; }
      });
      const req = new Request("http://localhost/batch", { method: "POST", headers: { "content-type": "application/json", ...(length ? { "content-length": length } : {}) }, body: stream, duplex: "half" } as RequestInit) as never;
      const response = await handler(req);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid batch request", code: "body_too_large" });
      expect(cancelled).toBe(true);
      noEffects();
    }
  });
  it("validates NaN and infinity without numeric normalization", () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => validateUsageBatch({ ...usageBody(), events: [{ ...event, inputTokens: value }] })).toThrow();
    }
  });
  it.each([usage, quota])("accepts exactly 1MiB and split UTF8, rejects malformed length and interrupted stream", async (handler) => {
    const body = JSON.stringify({ ...(handler === usage ? usageBody() : quotaBody()), additive: "\u00e9" });
    const bytes = new TextEncoder().encode(body + " ".repeat(MAX_BATCH_BODY_BYTES - Buffer.byteLength(body)));
    const split = bytes.indexOf(0xc3) + 1;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.slice(0, split)); controller.enqueue(bytes.slice(split)); controller.close(); } });
    const req = new Request("http://localhost/batch", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit) as never;
    expect((await handler(req)).status).toBe(200);
    vi.clearAllMocks();
    for (const length of ["-1", "1.2", "NaN", String(MAX_BATCH_BODY_BYTES + 1)]) {
      expect((await handler(request({}, { "content-length": length }))).status).toBe(400);
      noEffects();
    }
    const broken = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("secret-canary")); } });
    const brokenReq = new Request("http://localhost/batch", { method: "POST", headers: { "content-type": "application/json" }, body: broken, duplex: "half" } as RequestInit) as never;
    const response = await handler(brokenReq);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid batch request", code: "invalid_json" });
    noEffects();
  });
  it("accepts raw JSON depth/byte limits and exact row limits", async () => {
    expect((await usage(request({ ...usageBody(), events: Array(200).fill({ ...event, rawJson: nested(8) }) }))).status).toBe(200);
    expect((await quota(request({ snapshots: Array(100).fill({ ...snapshot, rawJson: "x".repeat(MAX_RAW_JSON_BYTES - 2) }) }))).status).toBe(400);
    // One 64KiB value fits; 100 such values exceed the independent body cap.
    expect((await quota(request({ snapshots: [{ ...snapshot, rawJson: "x".repeat(MAX_RAW_JSON_BYTES - 2) }] }))).status).toBe(200);
    expect((await quota(request({ snapshots: Array(100).fill(snapshot) }))).status).toBe(200);
  });
  it("preserves legacy usage, source enums, UTC precision and privacy/tenant minimization", async () => {
    const events = ["claude-code", "codex", "opencode", "aider", "kimicode"].map((source, index) => ({ ...event, source, sourceEventId: `event-${index}`, occurredAt: index % 2 ? "2026-10-07T12:00:00Z" : "2026-10-07T12:00:00.1Z", model: null, costUsd: null, userId: "tenant-b", deviceId: "device-b", rawJson: { assistant_text: "secret-canary" } }));
    expect((await usage(request({ ...usageBody(), userId: "tenant-b", events }))).status).toBe(200);
    const rows = mocks.prisma.usageEvent.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.userId === "tenant-a" && row.deviceId === "device-a")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("secret-canary");
  });
  it("preserves old quota wire without device, nullable fields and safe BigInt/Decimal boundaries", async () => {
    const response = await quota(request({ snapshots: [{ ...snapshot, userId: "tenant-b", capturedBy: "device-b", usedRaw: Number.MAX_SAFE_INTEGER, limitRaw: null, utilization: 1, unit: null, resetsAt: null }] }));
    expect(response.status).toBe(200);
    const row = mocks.prisma.quotaSnapshot.createMany.mock.calls[0][0].data[0];
    expect(row.userId).toBe("tenant-a");
    expect(row.capturedBy).toBe("device-a");
    expect(row.usedRaw).toBe(9007199254740991n);
    expect(row.limitRaw).toBeNull();
    expect(row.utilization.toString()).toBe("1");
  });
  it("keeps valid empty batches and usage Int/cost upper bounds compatible", async () => {
    expect((await usage(request({ ...usageBody(), events: [] }))).status).toBe(200);
    expect((await quota(request({ snapshots: [] }))).status).toBe(200);
    expect((await usage(request({ ...usageBody(), events: [{ ...event, inputTokens: MAX_USAGE_INT, outputTokens: 0, costUsd: 9_999_999_999 }] }))).status).toBe(200);
  });
});
