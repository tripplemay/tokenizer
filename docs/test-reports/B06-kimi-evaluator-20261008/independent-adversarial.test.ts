/**
 * Independent Kimi-family Evaluator adversarial probes for the B06 bounded
 * batch admission slice. Every expectation below is derived from
 * docs/specs/B06-bounded-server-schema-slice.md by the Evaluator; the
 * Generator's tests were not consulted while authoring these cases.
 *
 * Surface under test: the REAL route handlers at
 *   app/api/usage/events/batch/route.ts
 *   app/api/quota/snapshots/batch/route.ts
 *   src/server/batch-input.ts
 * with the database/auth/timezone/cache/pricing boundary mocked so that
 * "reject before write" can be asserted on every single rejection.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_AGENT_FEATURE_VERSION } from "../../../src/shared/agent-feature-version";
import { readBoundedBatchJson } from "../../../src/server/batch-input";

const CANARY = "kimi-canary-7f3c9e";
const ONE_MIB = 1_048_576;
const PG_INT_MAX = 2_147_483_647;
const JS_INT_MAX = Number.MAX_SAFE_INTEGER; // 9007199254740991

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  timezone: vi.fn(),
  cache: vi.fn(),
  price: vi.fn(),
  detect: vi.fn(),
  prisma: {
    device: { upsert: vi.fn() },
    deviceToken: { update: vi.fn() },
    project: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    usageEvent: { createMany: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    quotaSnapshot: { createMany: vi.fn() }
  }
}));
vi.mock("@/server/auth", () => ({
  authenticateDeviceToken: mocks.auth,
  unauthorized: () => Response.json({ error: "unauthorized" }, { status: 401 }),
  forbidden: (message = "forbidden") => Response.json({ error: message }, { status: 403 })
}));
vi.mock("@/server/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/server/timezone", () => ({ updateUserTimezoneIfValid: mocks.timezone }));
vi.mock("@/server/usage-cost-cache", () => ({ invalidateUsageCostCache: mocks.cache }));
vi.mock("@/server/pricing/trigger", () => ({ maybeTriggerPriceLookup: mocks.price }));
vi.mock("@/server/pricing/detect", () => ({ detectAndTrackUnpricedModels: mocks.detect }));

import { POST as usagePOST } from "../../../app/api/usage/events/batch/route";
import { POST as quotaPOST } from "../../../app/api/quota/snapshots/batch/route";

const TOKEN = { id: "tok-k", userId: "tenant-k", deviceId: "dev-k", device: { id: "dev-k", userId: "tenant-k" } };
const EVENT = { source: "kimicode", sourceEventId: "evt-k", occurredAt: "2026-10-07T12:00:00.000Z", inputTokens: 2, outputTokens: 3 };
const SNAPSHOT = { provider: "codex-chatgpt", accountKey: "acct-k", windowKey: "rate_limit_primary", utilization: 0.355 };
const usageBody = () => ({ device: { id: "dev-k", name: "Kimi Independent" }, timezone: "UTC", events: [EVENT] });

function jsonRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/batch", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body)
  }) as never;
}
function streamRequest(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    }
  });
  return new Request("http://localhost/batch", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: stream,
    duplex: "half"
  } as RequestInit) as never;
}
function noWrites() {
  for (const fn of [
    mocks.timezone, mocks.cache, mocks.price, mocks.detect,
    mocks.prisma.device.upsert, mocks.prisma.deviceToken.update,
    mocks.prisma.project.findFirst, mocks.prisma.project.findUnique, mocks.prisma.project.create,
    mocks.prisma.project.update, mocks.prisma.project.upsert,
    mocks.prisma.usageEvent.createMany, mocks.prisma.usageEvent.findMany, mocks.prisma.usageEvent.update,
    mocks.prisma.quotaSnapshot.createMany
  ]) expect(fn).not.toHaveBeenCalled();
}
async function expect400(handler: typeof usagePOST, body: unknown, code: string, row?: number) {
  const response = await handler(jsonRequest(body));
  expect(response.status).toBe(400);
  const result = await response.json();
  expect(result.error).toBe("invalid batch request");
  expect(result.code).toBe(code);
  if (row === undefined) expect("row" in result).toBe(false);
  else expect(result.row).toBe(row);
  expect(JSON.stringify(result)).not.toContain(CANARY);
  noWrites();
  return result;
}
function nested(levels: number): unknown {
  let value: unknown = "leaf";
  for (let i = 0; i < levels; i += 1) value = { value };
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(TOKEN);
  mocks.prisma.device.upsert.mockResolvedValue({ id: "dev-k" });
  mocks.prisma.project.findFirst.mockResolvedValue(null);
  mocks.prisma.project.create.mockResolvedValue({ id: "proj-k" });
  mocks.prisma.project.upsert.mockResolvedValue({ id: "proj-k" });
  mocks.prisma.usageEvent.createMany.mockImplementation(({ data }) => Promise.resolve({ count: data.length }));
  mocks.prisma.quotaSnapshot.createMany.mockImplementation(({ data }) => Promise.resolve({ count: data.length }));
  mocks.detect.mockResolvedValue([]);
});

describe("readBoundedBatchJson: transport and JSON gates (direct unit surface)", () => {
  const code = (error: unknown) => (error as { code?: string }).code;
  it("accepts application/json with charset and case variants, rejects sibling media types", async () => {
    await expect(readBoundedBatchJson(jsonRequest({ ok: 1 }, { "content-type": "Application/JSON; charset=utf-8" }))).resolves.toEqual({ ok: 1 });
    await expect(readBoundedBatchJson(jsonRequest({ ok: 1 }, { "content-type": "application/json;charset=utf-8" }))).resolves.toEqual({ ok: 1 });
    for (const type of ["application/jsonp", "application/json-patch", "text/json", "application/json2"]) {
      await expect(readBoundedBatchJson(jsonRequest({ ok: 1 }, { "content-type": type }))).rejects.toSatisfy((e) => code(e) === "invalid_content_type");
    }
  });
  it("rejects a missing content-type before reading bytes", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("{}")); controller.close(); }
    });
    const request = new Request("http://localhost/batch", { method: "POST", body: stream, duplex: "half" } as RequestInit) as never;
    expect((request as unknown as Request).headers.get("content-type")).toBeNull();
    await expect(readBoundedBatchJson(request)).rejects.toSatisfy((e) => code(e) === "invalid_content_type");
  });
  it("rejects malformed declared lengths and declared lengths over the cap", async () => {
    // Note: " 100" is not in this list — HTTP header values are trimmed of
    // leading/trailing whitespace by the platform Headers implementation, so
    // a padded length legitimately arrives as "100".
    for (const length of ["abc", "1.5", "-1", "+100", "1e6", String(ONE_MIB + 1), String(ONE_MIB * 2)]) {
      await expect(readBoundedBatchJson(jsonRequest({}, { "content-length": length }))).rejects.toSatisfy(
        (e) => code(e) === (/^\d+$/.test(length) ? "body_too_large" : "invalid_json")
      );
    }
    // A numeric-but-unusual declared length (leading zeros) is only an early
    // hint; the real byte stream is what gets capped.
    await expect(readBoundedBatchJson(jsonRequest({ ok: 1 }, { "content-length": "0100" }))).resolves.toEqual({ ok: 1 });
  });
  it("accepts a body of exactly 1,048,576 bytes and rejects 1,048,577", async () => {
    const exact = JSON.stringify({ pad: "x".repeat(ONE_MIB - 10) }); // {"pad":""} = 10 overhead bytes
    expect(new TextEncoder().encode(exact).byteLength).toBe(ONE_MIB);
    await expect(readBoundedBatchJson(jsonRequest(exact))).resolves.toBeTruthy();
    const over = JSON.stringify({ pad: "x".repeat(ONE_MIB - 9) });
    expect(new TextEncoder().encode(over).byteLength).toBe(ONE_MIB + 1);
    await expect(readBoundedBatchJson(jsonRequest(over))).rejects.toSatisfy((e) => code(e) === "body_too_large");
  });
  it("caps the real stream when the declared length lies", async () => {
    const over = new TextEncoder().encode(" ".repeat(ONE_MIB + 1));
    await expect(readBoundedBatchJson(streamRequest([over], { "content-length": "2" }))).rejects.toSatisfy((e) => code(e) === "body_too_large");
  });
  it("handles multibyte UTF-8 split across chunks, rejects truncated bytes and bad continuations", async () => {
    const body = new TextEncoder().encode(JSON.stringify({ addon: "é漢字🙂" }));
    const splitAt = body.indexOf(0xc3) + 1; // middle of the é sequence
    await expect(readBoundedBatchJson(streamRequest([body.slice(0, splitAt), body.slice(splitAt)]))).resolves.toEqual({ addon: "é漢字🙂" });
    await expect(readBoundedBatchJson(streamRequest([new Uint8Array([0x7b, 0xc3])]))).rejects.toSatisfy((e) => code(e) === "invalid_json");
    await expect(readBoundedBatchJson(streamRequest([new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])]))).rejects.toSatisfy((e) => code(e) === "invalid_json");
  });
  it("returns invalid_json for truncated JSON, garbage and mid-stream errors", async () => {
    await expect(readBoundedBatchJson(jsonRequest(`{"device":"${CANARY}`))).rejects.toSatisfy((e) => code(e) === "invalid_json");
    const broken = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error(CANARY)); } });
    const request = new Request("http://localhost/batch", { method: "POST", headers: { "content-type": "application/json" }, body: broken, duplex: "half" } as RequestInit) as never;
    await expect(readBoundedBatchJson(request)).rejects.toSatisfy((e) => code(e) === "invalid_json" && !(e as Error).message.includes(CANARY));
  });
  it("enforces depth 32 (root depth 0) and the 100,000 visited-value cap exactly", async () => {
    await expect(readBoundedBatchJson(jsonRequest({ addon: nested(31) }))).resolves.toBeTruthy(); // deepest value at depth 32
    await expect(readBoundedBatchJson(jsonRequest({ addon: nested(32) }))).rejects.toSatisfy((e) => code(e) === "invalid_json");
    await expect(readBoundedBatchJson(jsonRequest({ addon: Array(99_998).fill(0) }))).resolves.toBeTruthy(); // 100,000 nodes total
    await expect(readBoundedBatchJson(jsonRequest({ addon: Array(99_999).fill(0) }))).rejects.toSatisfy((e) => code(e) === "invalid_json");
  });
  it("rejects non-finite JSON numbers and NUL/surrogates anywhere, including keys", async () => {
    await expect(readBoundedBatchJson(jsonRequest(`{"n":1e400}`))).rejects.toSatisfy((e) => code(e) === "invalid_json");
    await expect(readBoundedBatchJson(jsonRequest(`{"n":-1e400}`))).rejects.toSatisfy((e) => code(e) === "invalid_json");
    await expect(readBoundedBatchJson(jsonRequest(`{"${CANARY}\\u0000x":1}`))).rejects.toSatisfy((e) => code(e) === "invalid_json");
    await expect(readBoundedBatchJson(jsonRequest(`{"s":"\\ud800"}`))).rejects.toSatisfy((e) => code(e) === "invalid_json");
    await expect(readBoundedBatchJson(jsonRequest(`{"s":"\\udfff"}`))).rejects.toSatisfy((e) => code(e) === "invalid_json");
    await expect(readBoundedBatchJson(jsonRequest(`{"s":"${CANARY}\\u0000"}`))).rejects.toSatisfy((e) => code(e) === "invalid_json");
  });
  it("duplicate keys resolve last-wins; __proto__ keys never pollute the prototype", async () => {
    await expect(readBoundedBatchJson(jsonRequest(`{"events":[],"events":"${CANARY}"}`))).resolves.toEqual({ events: CANARY });
    const parsed = await readBoundedBatchJson(jsonRequest(`{"__proto__":{"polluted":"${CANARY}"},"snapshots":[]}`));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(parsed, "__proto__")).toBe(true);
  });
});

describe("usage route: admission ordering", () => {
  it("401 before consuming the body when the credential is missing/revoked", async () => {
    mocks.auth.mockResolvedValue(null);
    const request = jsonRequest(usageBody());
    expect((await usagePOST(request)).status).toBe(401);
    expect((request as unknown as Request).bodyUsed).toBe(false);
    noWrites();
  });
  it("403 before consuming the body when the token's device binding is inconsistent", async () => {
    for (const broken of [
      { ...TOKEN, device: null },
      { ...TOKEN, device: { id: "dev-other", userId: "tenant-k" } },
      { ...TOKEN, device: { id: "dev-k", userId: "tenant-other" } }
    ]) {
      mocks.auth.mockResolvedValue(broken);
      const request = jsonRequest(usageBody());
      expect((await usagePOST(request)).status).toBe(403);
      expect((request as unknown as Request).bodyUsed).toBe(false);
      noWrites();
    }
  });
  it("403 after full validation when the body names a foreign device, still without writes", async () => {
    const response = await usagePOST(jsonRequest({ ...usageBody(), device: { id: "dev-foreign", name: "Foreign" } }));
    expect(response.status).toBe(403);
    noWrites();
  });
});

describe("usage route: envelope and row-count bounds", () => {
  it.each([null, 42, [], {}, { events: {} }, { events: "x" }, { device: { id: "dev-k", name: "n" } }])(
    "rejects malformed envelope %j as invalid_batch", async (body) => expect400(usagePOST, body, "invalid_batch")
  );
  it("accepts exactly 200 rows, rejects 201 as batch_too_large before row validation", async () => {
    const events = Array.from({ length: 200 }, (_, i) => ({ ...EVENT, sourceEventId: `evt-${i}` }));
    expect((await usagePOST(jsonRequest({ ...usageBody(), events }))).status).toBe(200);
    vi.clearAllMocks();
    const poisonedTail = [...events.slice(0, 200), { source: 1, sourceEventId: 2 }];
    await expect400(usagePOST, { ...usageBody(), events: poisonedTail }, "batch_too_large");
  });
  it("keeps the empty batch a 200 heartbeat: device/token sync state advances, zero event rows", async () => {
    const response = await usagePOST(jsonRequest({ ...usageBody(), events: [] }));
    expect(response.status).toBe(200);
    expect(mocks.prisma.device.upsert).toHaveBeenCalledOnce();
    expect(mocks.prisma.deviceToken.update).toHaveBeenCalledOnce();
    expect(mocks.prisma.usageEvent.createMany).not.toHaveBeenCalled(); // ingest early-returns on zero rows
  });
});

describe("usage route: per-row adversarial matrix (mixed good+poison, whole-batch 400)", () => {
  it.each([
    ["unknown source", { source: "gpt-5" }],
    ["null source", { source: null }],
    ["numeric source", { source: 7 }],
    ["blank sourceEventId", { sourceEventId: "   " }],
    ["2049-char sourceEventId", { sourceEventId: "x".repeat(2049) }],
    ["numeric sourceEventId", { sourceEventId: 42 }],
    ["inputTokens PG int overflow", { inputTokens: PG_INT_MAX + 1 }],
    ["inputTokens negative", { inputTokens: -1 }],
    ["inputTokens fractional", { inputTokens: 0.5 }],
    ["inputTokens string", { inputTokens: "5" }],
    ["inputTokens null", { inputTokens: null }],
    ["inputTokens boolean", { inputTokens: true }],
    ["outputTokens unsafe", { outputTokens: JS_INT_MAX + 1 }],
    ["cachedInputTokens null", { cachedInputTokens: null }],
    ["webSearchRequests 2.5", { webSearchRequests: 2.5 }],
    ["totalTokens overflow", { totalTokens: PG_INT_MAX + 1 }],
    ["fallback sum overflow", { inputTokens: PG_INT_MAX, outputTokens: 1, totalTokens: 0 }],
    ["costUsd at exclusive ceiling", { costUsd: 10_000_000_000 }],
    ["costUsd negative", { costUsd: -0.01 }],
    ["costUsd string", { costUsd: "1.25" }],
    ["occurredAt impossible day", { occurredAt: "2026-02-29T12:00:00Z" }],
    ["occurredAt month 13", { occurredAt: "2026-13-01T00:00:00Z" }],
    ["occurredAt hour 24", { occurredAt: "2026-10-07T24:00:00Z" }],
    ["occurredAt leap second", { occurredAt: "2026-06-30T23:59:60Z" }],
    ["occurredAt 4-digit fraction", { occurredAt: "2026-10-07T12:00:00.1234Z" }],
    ["occurredAt lowercase z", { occurredAt: "2026-10-07t12:00:00z" }],
    ["occurredAt with offset", { occurredAt: "2026-10-07T12:00:00+00:00" }],
    ["occurredAt date only", { occurredAt: "2026-10-07" }],
    ["occurredAt year 0000", { occurredAt: "0000-12-31T23:59:59Z" }],
    ["model 257 chars", { model: "m".repeat(257) }],
    ["model object", { model: {} }],
    ["model C1 control", { model: `mod${CANARY}\u0085` }],
    ["model DEL control", { model: "mod\u007f" }],
    ["sessionId tab control", { sessionId: "s\ttail" }],
    ["projectName 201 chars", { projectName: "p".repeat(201) }],
    ["sessionId 513 chars", { sessionId: "s".repeat(513) }],
    ["workspacePath 4097 chars", { workspacePath: "w".repeat(4097) }],
    ["repoKey 2049 chars", { repoKey: "r".repeat(2049) }],
    ["gitRemote 4097 chars", { gitRemote: "g".repeat(4097) }],
    ["gitBranch 513 chars", { gitBranch: "b".repeat(513) }],
    ["gitCommit 129 chars", { gitCommit: "c".repeat(129) }],
    ["serviceTier 101 chars", { serviceTier: "t".repeat(101) }],
    ["fallbackToModel 257 chars", { fallbackToModel: "f".repeat(257) }],
    ["newline in projectName", { projectName: "a\nb" }]
  ])("rejects %s at row 1 with no writes", async (_name, patch) => {
    await expect400(usagePOST, { ...usageBody(), events: [EVENT, { ...EVENT, ...patch }] }, "invalid_event", 1);
  });
  it("reports row 0 and row 199 indices correctly", async () => {
    await expect400(usagePOST, { ...usageBody(), events: [{ ...EVENT, inputTokens: -1 }, EVENT] }, "invalid_event", 0);
    const rows = Array.from({ length: 200 }, (_, i) => ({ ...EVENT, sourceEventId: `ok-${i}` }));
    rows[199] = { ...EVENT, sourceEventId: "" };
    await expect400(usagePOST, { ...usageBody(), events: rows }, "invalid_event", 199);
  });
  it("NUL anywhere in the body is a global invalid_json, not a row error", async () => {
    await expect400(usagePOST, { ...usageBody(), events: [{ ...EVENT, sessionId: `${CANARY}\u0000` }] }, "invalid_json");
  });
});

describe("usage route: rawJson / codex cumulative / device / timezone bounds", () => {
  it("rawJson depth 8 ok, 9 rejected; 65,536 serialized bytes ok, 65,537 rejected; scalars allowed", async () => {
    expect((await usagePOST(jsonRequest({ ...usageBody(), events: [{ ...EVENT, rawJson: nested(8) }] }))).status).toBe(200);
    vi.clearAllMocks();
    await expect400(usagePOST, { ...usageBody(), events: [{ ...EVENT, rawJson: nested(9) }] }, "invalid_raw_json", 0);
    expect((await usagePOST(jsonRequest({ ...usageBody(), events: [{ ...EVENT, rawJson: "x".repeat(65_534) }] }))).status).toBe(200); // +2 quotes = 65,536 bytes
    vi.clearAllMocks();
    await expect400(usagePOST, { ...usageBody(), events: [{ ...EVENT, rawJson: "x".repeat(65_535) }] }, "invalid_raw_json", 0);
    for (const scalar of [null, true, 42, "str"]) {
      vi.clearAllMocks();
      expect((await usagePOST(jsonRequest({ ...usageBody(), events: [{ ...EVENT, rawJson: scalar }] }))).status).toBe(200);
    }
  });
  it("codex cumulative identity counters: safe integers only, exact MAX_SAFE boundary", async () => {
    const wrap = (total_token_usage: unknown) => ({ ...usageBody(), events: [{ ...EVENT, source: "codex", rawJson: { payload: { info: { total_token_usage } } } }] });
    expect((await usagePOST(jsonRequest(wrap({ total_tokens: JS_INT_MAX })))).status).toBe(200);
    vi.clearAllMocks();
    await expect400(usagePOST, wrap({ total_tokens: JS_INT_MAX + 1 }), "invalid_event", 0);
    await expect400(usagePOST, wrap({ input_tokens: -1 }), "invalid_event", 0);
    await expect400(usagePOST, wrap({ output_tokens: 1.5 }), "invalid_event", 0);
    await expect400(usagePOST, wrap({ reasoning_output_tokens: "9" }), "invalid_event", 0);
    await expect400(usagePOST, wrap("not-an-object"), "invalid_event", 0);
    expect((await usagePOST(jsonRequest(wrap({ future_counter: JS_INT_MAX + 1 })))).status).toBe(200); // unknown additive counters tolerated
  });
  it("device field/name/hostname/platform/metadata bounds", async () => {
    const device = (patch: unknown) => ({ ...usageBody(), device: { id: "dev-k", name: "Kimi Independent", ...(patch as object) } });
    await expect400(usagePOST, device({ id: "x".repeat(201) }), "invalid_device");
    await expect400(usagePOST, device({ name: "" }), "invalid_device");
    await expect400(usagePOST, device({ name: null }), "invalid_device");
    await expect400(usagePOST, device({ hostname: "h".repeat(256) }), "invalid_device");
    await expect400(usagePOST, device({ platform: "p".repeat(101) }), "invalid_device");
    await expect400(usagePOST, device({ metadata: nested(9) }), "invalid_raw_json");
    expect((await usagePOST(jsonRequest(device({ hostname: "h".repeat(255), platform: "p".repeat(100), metadata: nested(8) })))).status).toBe(200);
  });
  it("diagnostics bounds: feature version, queueDepth, sync status, harness strictness", async () => {
    const diag = (diagnostics: unknown) => ({ ...usageBody(), device: { id: "dev-k", name: "Kimi Independent", diagnostics } });
    expect((await usagePOST(jsonRequest(diag({ agentFeatureVersion: MAX_AGENT_FEATURE_VERSION, queueDepth: PG_INT_MAX, lastSyncStatus: "failed" })))).status).toBe(200);
    vi.clearAllMocks();
    await expect400(usagePOST, diag({ agentFeatureVersion: MAX_AGENT_FEATURE_VERSION + 1 }), "invalid_device");
    await expect400(usagePOST, diag({ agentFeatureVersion: -1 }), "invalid_device");
    await expect400(usagePOST, diag({ agentFeatureVersion: 1.5 }), "invalid_device");
    await expect400(usagePOST, diag({ queueDepth: PG_INT_MAX + 1 }), "invalid_device");
    await expect400(usagePOST, diag({ queueDepth: null }), "invalid_device");
    await expect400(usagePOST, diag({ lastSyncStatus: "SUCCESS" }), "invalid_device");
    await expect400(usagePOST, diag({ agentVersion: "v".repeat(129) }), "invalid_device");
    await expect400(usagePOST, diag({ agentReleaseVersion: "r".repeat(129) }), "invalid_device");
    await expect400(usagePOST, diag({ lastError: "e".repeat(2049) }), "invalid_device");
    await expect400(usagePOST, diag({ harness: { garbage: CANARY } }), "invalid_device");
    await expect400(usagePOST, diag(null), "invalid_device");
    expect((await usagePOST(jsonRequest(diag({ agentVersion: null, agentReleaseVersion: null, agentFeatureVersion: null, queueDepth: 0, lastError: null, lastSyncStatus: null })))).status).toBe(200);
  });
  it("timezone: optional, nonblank, <=64, real IANA zone", async () => {
    const tz = (timezone: unknown) => ({ ...usageBody(), timezone });
    for (const good of ["UTC", "Asia/Shanghai", "America/New_York", "utc"]) {
      vi.clearAllMocks();
      expect((await usagePOST(jsonRequest(tz(good)))).status).toBe(200);
    }
    vi.clearAllMocks();
    const without = usageBody() as Record<string, unknown>;
    delete without.timezone;
    expect((await usagePOST(jsonRequest(without))).status).toBe(200);
    vi.clearAllMocks();
    await expect400(usagePOST, tz(""), "invalid_timezone");
    await expect400(usagePOST, tz("  "), "invalid_timezone");
    await expect400(usagePOST, tz("Mars/Olympus_Mons"), "invalid_timezone");
    await expect400(usagePOST, tz("x".repeat(65)), "invalid_timezone");
    await expect400(usagePOST, tz(null), "invalid_timezone");
  });
});

describe("quota route: envelope, rows and old-Agent compatibility", () => {
  it.each([null, 42, [], {}, { snapshots: {} }, { snapshots: "x" }])(
    "rejects malformed envelope %j as invalid_batch", async (body) => expect400(quotaPOST, body, "invalid_batch")
  );
  it("accepts exactly 100 rows, rejects 101 as batch_too_large", async () => {
    expect((await quotaPOST(jsonRequest({ snapshots: Array(100).fill(SNAPSHOT) }))).status).toBe(200);
    vi.clearAllMocks();
    await expect400(quotaPOST, { snapshots: Array(101).fill(SNAPSHOT) }, "batch_too_large");
  });
  it.each([
    ["unknown provider", { provider: "openai" }],
    ["null provider", { provider: null }],
    ["blank accountKey", { accountKey: "" }],
    ["257-char accountKey", { accountKey: "a".repeat(257) }],
    ["blank windowKey", { windowKey: "  " }],
    ["201-char windowKey", { windowKey: "w".repeat(201) }],
    ["numeric windowKey", { windowKey: 9 }],
    ["101-char unit", { unit: "u".repeat(101) }],
    ["numeric unit", { unit: 4 }],
    ["utilization above 1", { utilization: 1.0000001 }],
    ["utilization negative", { utilization: -0.1 }],
    ["utilization string", { utilization: "0.5" }],
    ["utilization boolean", { utilization: true }],
    ["usedRaw fractional", { usedRaw: 0.5 }],
    ["usedRaw negative", { usedRaw: -1 }],
    ["usedRaw string", { usedRaw: "10" }],
    ["usedRaw unsafe", { usedRaw: JS_INT_MAX + 1 }],
    ["limitRaw unsafe", { limitRaw: JS_INT_MAX + 1 }],
    ["limitRaw string", { limitRaw: "0" }],
    ["resetsAt invalid month", { resetsAt: "2026-13-01T00:00:00Z" }],
    ["resetsAt with offset", { resetsAt: "2026-10-07T12:00:00+07:00" }],
    ["resetsAt date only", { resetsAt: "2026-10-07" }]
  ])("rejects poison quota row (%s) at row 1 before Decimal/BigInt writes", async (_name, patch) => {
    await expect400(quotaPOST, { snapshots: [SNAPSHOT, { ...SNAPSHOT, ...patch }] }, "invalid_snapshot", 1);
  });
  it("empty snapshots stay 200 and touch nothing", async () => {
    const response = await quotaPOST(jsonRequest({ snapshots: [] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: 0, inserted: 0 });
    noWrites();
  });
  it("old device-less wire with MAX_SAFE BigInt and nullable fields stays valid and tenant-bound", async () => {
    const response = await quotaPOST(jsonRequest({
      snapshots: [{ ...SNAPSHOT, userId: "tenant-evil", capturedBy: "dev-evil", usedRaw: JS_INT_MAX, limitRaw: null, utilization: 1, unit: null, resetsAt: null }]
    }));
    expect(response.status).toBe(200);
    const row = mocks.prisma.quotaSnapshot.createMany.mock.calls[0][0].data[0];
    expect(row.userId).toBe("tenant-k");
    expect(row.capturedBy).toBe("dev-k");
    expect(row.usedRaw).toBe(9007199254740991n);
    expect(row.limitRaw).toBeNull();
    expect(row.utilization.toString()).toBe("1");
  });
  it("quota device without name is valid; foreign quota device is 403 without writes", async () => {
    expect((await quotaPOST(jsonRequest({ snapshots: [SNAPSHOT], device: { id: "dev-k" } }))).status).toBe(200);
    vi.clearAllMocks();
    expect((await quotaPOST(jsonRequest({ snapshots: [SNAPSHOT], device: { id: "dev-foreign" } }))).status).toBe(403);
    noWrites();
    await expect400(quotaPOST, { snapshots: [SNAPSHOT], device: { id: "" } }, "invalid_device");
  });
});

describe("both routes: shared transport gates end-to-end", () => {
  it.each([["usage", usagePOST], ["quota", quotaPOST]] as const)("%s: wrong media type, garbage JSON, bad UTF-8 and depth-33 all safe 400", async (_name, handler) => {
    expect((await handler(jsonRequest({}, { "content-type": "text/plain" }))).status).toBe(400);
    noWrites();
    const result = await (await handler(jsonRequest(`{"x":"${CANARY}`))).json();
    expect(result).toEqual({ error: "invalid batch request", code: "invalid_json" });
    noWrites();
    expect((await handler(streamRequest([new Uint8Array([0xff])]))).status).toBe(400);
    noWrites();
    await expect400(handler, nested(33), "invalid_json");
  });
  it.each([["usage", usagePOST], ["quota", quotaPOST]] as const)("%s: declared length over the cap is an early body_too_large with no writes", async (_name, handler) => {
    const stream = new ReadableStream<Uint8Array>({ start() { /* never enqueues */ } });
    const request = new Request("http://localhost/batch", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(ONE_MIB + 1) },
      body: stream, duplex: "half"
    } as RequestInit) as never;
    const response = await handler(request);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("body_too_large");
    noWrites();
  });
});

describe("positive controls: valid old-Agent wires still write exactly once", () => {
  it("usage: full legacy wire with all sources, nullables and UTC precision variants", async () => {
    const sources = ["claude-code", "codex", "opencode", "aider", "kimicode"];
    const events = sources.map((source, i) => ({
      ...EVENT, source, sourceEventId: `legacy-${i}`,
      occurredAt: i % 2 ? "2026-10-07T12:00:00Z" : "2026-10-07T12:00:00.1Z",
      model: null, costUsd: null, inputTokens: PG_INT_MAX, outputTokens: 0
    }));
    const response = await usagePOST(jsonRequest({ ...usageBody(), events }));
    expect(response.status).toBe(200);
    const rows = mocks.prisma.usageEvent.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(5);
    expect(rows.every((row: { userId: string; deviceId: string }) => row.userId === "tenant-k" && row.deviceId === "dev-k")).toBe(true);
  });
  it("usage: negative zero and exponent-form numbers follow JSON semantics", async () => {
    const response = await usagePOST(jsonRequest({ ...usageBody(), events: [{ ...EVENT, inputTokens: -0, outputTokens: 1e3 }] }));
    expect(response.status).toBe(200);
  });
});
