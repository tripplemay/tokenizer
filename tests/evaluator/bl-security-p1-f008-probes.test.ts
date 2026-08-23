/**
 * Evaluator-owned adversarial probes for BL-SECURITY-P1 F008 (kimi, fix_round 0).
 *
 * Pure sections always run. DB sections are gated on EVAL_DB_URL and require a
 * migrated scratch PostgreSQL (DATABASE_URL must match exactly):
 *
 *   U=postgresql://eval:eval@127.0.0.1:5545/blsec_eval \
 *   EVAL_DB_URL=$U DATABASE_URL=$U \
 *   npx vitest run tests/evaluator/bl-security-p1-f008-probes.test.ts
 *
 * F007 expectations are recomputed here from raw fixture values by an
 * independent implementation; Generator-authored expected literals are not
 * consulted.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { safeCallbackPath } from "../../src/shared/url";
import { escapeHtml } from "../../src/shared/html-escape";
import {
  isValidDeviceName,
  sanitizeDeviceForIngest,
  sanitizeUsageEventForIngest,
  MAX_DEVICE_NAME_LENGTH,
  MAX_SOURCE_LENGTH
} from "../../src/shared/input-sanitization";
import { isEnrollmentClaimed, enrollmentPollDelayMs } from "../../src/shared/enrollment-status";
import { batchCostCacheNowMs, CLOSED_BATCH_NOW_MS } from "../../src/server/harness-cost";
import { estimateCost, MODEL_PRICES } from "../../src/shared/model-pricing";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  signDecision: vi.fn(),
  authenticateDeviceToken: vi.fn(),
  updateTimezone: vi.fn(),
  detectAndTrackUnpricedModels: vi.fn(),
  maybeTriggerPriceLookup: vi.fn()
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/server/harness-sign", () => ({
  HarnessSigningKeyMissingError: class HarnessSigningKeyMissingError extends Error {},
  signDecision: mocks.signDecision
}));
vi.mock("@/server/auth", () => ({
  authenticateDeviceToken: mocks.authenticateDeviceToken,
  unauthorized: () => Response.json({ error: "unauthorized" }, { status: 401 }),
  forbidden: (message: string) => Response.json({ error: message }, { status: 403 })
}));
vi.mock("@/server/timezone", () => ({ updateUserTimezoneIfValid: mocks.updateTimezone }));
vi.mock("@/server/pricing/detect", () => ({ detectAndTrackUnpricedModels: mocks.detectAndTrackUnpricedModels }));
vi.mock("@/server/pricing/trigger", () => ({ maybeTriggerPriceLookup: mocks.maybeTriggerPriceLookup }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

// ---------------------------------------------------------------- F002 ----
describe("F002 safeCallbackPath adversarial vectors (evaluator)", () => {
  const MALICIOUS: string[] = [
    "https://evil.example",
    "http://evil.example/path",
    "HTTPS://evil.example",
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "/\\/evil.example",
    "%2F%2Fevil.example",
    "%2f%2fEvil.Example",
    "%5C%5Cevil.example",
    "%2F%252F%2Fevil.example", // nested double encoding → decodes to //%2F...
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>x</script>",
    "vbscript:msgbox(1)",
    "http:/evil",
    "https:evil.example",
    " https://evil.example", // leading whitespace
    "/models/abc ", // trailing whitespace
    "/\tmodels",
    "/models\n/abc",
    "/\\",
    " "
  ];
  it.each(MALICIOUS)("falls back to / for %j", (vector) => {
    expect(safeCallbackPath(vector)).toBe("/");
  });

  it("returns legitimate same-origin paths byte-for-byte", () => {
    for (const ok of ["/", "/models/abc", "/devices/x?a=1#h", "/harness/BL-1?x=%2F"]) {
      expect(safeCallbackPath(ok)).toBe(ok);
    }
  });

  it("re-validates after decoding: encoded traversal cannot escape", () => {
    expect(safeCallbackPath("/%2F%2Fevil.example")).toBe("/"); // decodes to ///evil.example
    expect(safeCallbackPath("/%5C%5Cevil.example")).toBe("/");
    // legitimately encoded but same-origin after decode → original preserved
    expect(safeCallbackPath("/models%2Fabc")).toBe("/models%2Fabc");
  });

  it("non-string input fails closed", () => {
    expect(safeCallbackPath(undefined)).toBe("/");
    expect(safeCallbackPath(null)).toBe("/");
  });
});

// ---------------------------------------------------------------- F003 ----
describe("F003 stored-XSS chain: sanitize at ingest → escape at render (evaluator)", () => {
  const PAYLOAD = '<img src=x onerror=alert(1)>';
  const HOSTILE = `${PAYLOAD}\u0001${"y".repeat(500)}`;

  it("hot path truncates and strips control characters instead of rejecting", () => {
    const device = sanitizeDeviceForIngest({ id: "dev-1", name: HOSTILE });
    expect(device.name.length).toBeLessThanOrEqual(MAX_DEVICE_NAME_LENGTH);
    expect(device.name).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
    const event = sanitizeUsageEventForIngest({
      source: `unknownsource${"x".repeat(300)}`
    } as never);
    expect(event.source.length).toBeLessThanOrEqual(MAX_SOURCE_LENGTH);
    expect(event.source).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
    // unknown source values are NOT enum-rejected (no closed set)
    expect(event.source).toMatch(/^unknownsource/);
  });

  it("render layer escapes the persisted hostile name for tooltip HTML", () => {
    const persisted = sanitizeDeviceForIngest({ id: "dev-1", name: HOSTILE }).name;
    expect(persisted).toContain("<img"); // stored raw — defense lives at render
    const html = escapeHtml(persisted);
    expect(html).not.toContain("<");
    expect(html).not.toContain(">");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("escapes every special class including quotes and backtick", () => {
    expect(escapeHtml(`&<>"'\``)).toBe("&amp;&lt;&gt;&quot;&#39;&#96;");
  });

  it("enroll-side validator is the hard boundary (length + control chars)", () => {
    expect(isValidDeviceName("x".repeat(MAX_DEVICE_NAME_LENGTH))).toBe(true);
    expect(isValidDeviceName("x".repeat(MAX_DEVICE_NAME_LENGTH + 1))).toBe(false);
    expect(isValidDeviceName("bad\u0007name")).toBe(false);
    expect(isValidDeviceName("")).toBe(false);
    expect(isValidDeviceName(42)).toBe(false);
  });
});

// ---------------------------------------------------------------- F006 ----
describe("F006 enrollment claim + backoff pure behavior (evaluator)", () => {
  it("F-04 reproduction: unrelated new device must not claim this enrollment", () => {
    // state observed by the card while another device exists but THIS token is unused
    expect(isEnrollmentClaimed({ usedById: null })).toBe(false);
    expect(isEnrollmentClaimed({ usedById: "dev-9" })).toBe(true);
  });
  it("backoff doubles and caps", () => {
    const seq = [0, 1, 2, 3, 4, 5, 6].map(enrollmentPollDelayMs);
    for (let i = 1; i < seq.length; i += 1) expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1]);
    expect(seq[0]).toBe(1000);
    expect(seq.at(-1)).toBe(10000);
  });
});

// ------------------------------------------- F007 cache-key boundaries ----
describe("F007 cache-key decision boundaries (evaluator)", () => {
  const T = (toStatus: string, at: string, extra: Record<string, unknown> = {}) => ({
    fromStatus: null,
    toStatus,
    toBatch: "BL-X",
    batchBoundary: false,
    fixRounds: 0,
    observedAt: new Date(at),
    ...extra
  });
  const CLOSED = [
    T("building", "2026-08-10T10:00:00Z"),
    T("done", "2026-08-10T11:00:00Z")
  ];
  const ACTIVE = [T("building", "2026-08-10T10:00:00Z")];

  it("closed batch pins the sentinel across >30s of wall clock; active batch tracks now", () => {
    const t1 = new Date("2026-08-10T12:00:07Z").getTime();
    const t2 = new Date("2026-08-10T12:00:39Z").getTime(); // different 30s quantum
    expect(batchCostCacheNowMs(CLOSED, t1)).toBe(CLOSED_BATCH_NOW_MS);
    expect(batchCostCacheNowMs(CLOSED, t2)).toBe(CLOSED_BATCH_NOW_MS);
    expect(batchCostCacheNowMs(ACTIVE, t1)).toBe(t1);
    expect(batchCostCacheNowMs(ACTIVE, t2)).toBe(t2);
  });

  it("out-of-order transitions reach the same verdict", () => {
    expect(batchCostCacheNowMs([...CLOSED].reverse(), Date.parse("2026-08-10T12:00:00Z"))).toBe(CLOSED_BATCH_NOW_MS);
  });

  it("same-millisecond transitions do not resurrect open state", () => {
    const sameMs = [T("building", "2026-08-10T10:00:00Z"), T("done", "2026-08-10T10:00:00Z")];
    expect(batchCostCacheNowMs(sameMs, Date.parse("2026-08-10T10:00:00Z"))).toBe(CLOSED_BATCH_NOW_MS);
  });

  it("now exactly on the open edge keeps the batch active", () => {
    const edge = Date.parse("2026-08-10T10:00:00Z");
    expect(batchCostCacheNowMs(ACTIVE, edge)).toBe(edge); // zero-width but openEnded → not closed
  });

  it("clock skew (now before last observation) never marks an open batch closed", () => {
    const skewed = Date.parse("2026-08-10T09:00:00Z");
    expect(batchCostCacheNowMs(ACTIVE, skewed)).toBe(skewed);
  });
});

// ------------------------------------------------- DB-gated adversarial ---
const DB_URL = process.env.EVAL_DB_URL;
const describeDb = DB_URL ? describe : describe.skip;

describeDb("DB-backed adversarial probes (scratch PostgreSQL)", () => {
  const USER = "user-f008-eval";
  const DEVICE = "device-f008-eval";
  let prisma: typeof import("../../src/server/db").prisma;

  beforeAll(async () => {
    if (process.env.DATABASE_URL !== DB_URL) {
      throw new Error("DATABASE_URL must exactly match EVAL_DB_URL");
    }
    ({ prisma } = await import("../../src/server/db"));
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: "f008-eval@example.test" } });
    await prisma.device.create({ data: { id: DEVICE, userId: USER, name: "F008 eval" } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.$disconnect();
  });

  it("F004: two genuinely concurrent approvals → exactly one 200, one 409, single stored sig", async () => {
    const { POST } = await import("../../app/api/harness/gates/route");
    await prisma.harnessProject.create({
      data: {
        id: "project-f008-eval",
        userId: USER,
        deviceId: DEVICE,
        repoKey: "github.com/acme/f008-eval",
        name: "F008 eval",
        status: "verifying",
        batch: "BL-SECURITY-P1"
      }
    });
    await prisma.harnessGate.create({
      data: {
        id: "gate-f008-eval",
        userId: USER,
        harnessProjectId: "project-f008-eval",
        gateId: "BL-SECURITY-P1-verifying-done",
        kind: "phase_advance",
        batch: "BL-SECURITY-P1",
        fromStatus: "verifying",
        toStatus: "done",
        detail: "F008 concurrent probe",
        raisedAt: new Date("2026-08-10T12:00:00Z"),
        raisedBy: "evaluator"
      }
    });
    mocks.auth.mockResolvedValue({ user: { id: USER, email: "f008-eval@example.test", name: "F008" } });
    let n = 0;
    mocks.signDecision.mockImplementation(() => `eval-sig-${++n}`);

    const req = () =>
      new Request("http://localhost/api/harness/gates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "gate-f008-eval", action: "approve" })
      }) as never;
    const [r1, r2] = await Promise.all([POST(req()), POST(req())]);
    const bodies = [await r1.json(), await r2.json()];
    const statuses = [r1.status, r2.status].sort();
    console.log(`F004 concurrent statuses: ${r1.status}, ${r2.status}`);
    expect(statuses).toEqual([200, 409]);
    const stored = await prisma.harnessGate.findUniqueOrThrow({ where: { id: "gate-f008-eval" } });
    const winner = bodies[[r1.status, r2.status].indexOf(200)];
    console.log(`F004 stored decisionSig matches 200-response sig: ${stored.decisionSig === winner.sig}`);
    expect(stored.decisionAction).toBe("approve");
    expect(stored.decisionSig).toBe(winner.sig);
    expect(bodies[[r1.status, r2.status].indexOf(409)]).not.toHaveProperty("sig");

    // second decision attempt on an already-decided gate → 409, no overwrite
    const r3 = await POST(req());
    expect(r3.status).toBe(409);
    const after = await prisma.harnessGate.findUniqueOrThrow({ where: { id: "gate-f008-eval" } });
    expect(after.decisionSig).toBe(stored.decisionSig);
  });

  it("F003 e2e: poison batch returns 2xx, persists sanitized values, renders tooltip-safe", async () => {
    const { POST } = await import("../../app/api/usage/events/batch/route");
    mocks.authenticateDeviceToken.mockResolvedValue({ id: "tok-f008", userId: USER, deviceId: "device-f008-poison" });
    mocks.detectAndTrackUnpricedModels.mockResolvedValue([]);
    // token row must exist: ingest stamps lastUsedAt on it after device upsert
    await prisma.device.create({ data: { id: "device-f008-poison", userId: USER, name: "pre" } });
    await prisma.deviceToken.create({
      data: { id: "tok-f008", userId: USER, deviceId: "device-f008-poison", tokenHash: "f008-hash", prefix: "f008" }
    });
    const hostileName = `<img src=x onerror=alert(1)>${"z".repeat(500)}`;
    const response = await POST(
      new Request("http://localhost/api/usage/events/batch", {
        method: "POST",
        headers: { authorization: "Bearer tok", "content-type": "application/json" },
        body: JSON.stringify({
          device: { id: "device-f008-poison", name: hostileName },
          events: [
            {
              source: `brandnewsource${"x".repeat(200)}`,
              sourceEventId: "f008-e1",
              model: "claude-fable-5",
              occurredAt: "2026-08-10T00:00:00.000Z",
              inputTokens: 1,
              outputTokens: 1
            }
          ]
        })
      }) as never
    );
    console.log(`F003 poison batch HTTP status: ${response.status}`);
    expect(response.status).toBe(200);

    const device = await prisma.device.findUniqueOrThrow({ where: { id: "device-f008-poison" } });
    const events = await prisma.usageEvent.findMany({ where: { sourceEventId: "f008-e1" } });
    expect(events).toHaveLength(1); // event ingested — queue-pinning path avoided
    expect(device.name!.length).toBeLessThanOrEqual(MAX_DEVICE_NAME_LENGTH);
    expect(device.name).not.toMatch(/[\u0000-\u001F]/);
    expect(events[0].source.length).toBeLessThanOrEqual(MAX_SOURCE_LENGTH);
    expect(events[0].source).toMatch(/^brandnewsource/); // no closed-set rejection
    const tooltipHtml = escapeHtml(device.name!);
    expect(tooltipHtml).not.toContain("<");
    expect(tooltipHtml).toContain("&lt;img");
  });

  it("F007: independent recompute of the audit fixture + exactly one aggregate query", async () => {
    const { getBatchCost } = await import("../../src/server/harness-cost");
    const PROJECT = "project-f008-audit";
    await prisma.project.create({
      data: { id: PROJECT, userId: USER, name: "F008 audit", repoKey: "github.com/audit/f008" }
    });
    // raw fixture values (BL-COST-BATCH-V1 audit shape)
    const E = (id: string, at: string, model: string, input: number, cached: number, write: number, output: number) => ({
      userId: USER, deviceId: DEVICE, projectId: PROJECT, source: "audit",
      sourceEventId: `f008-${id}`, model, inputTokens: input, cachedInputTokens: cached,
      cacheWriteTokens: write, outputTokens: output, totalTokens: input + output,
      occurredAt: new Date(at)
    });
    const events = [
      E("E1", "2026-08-09T18:35:00Z", "claude-fable-5", 200_000, 150_000, 20_000, 5_000),
      E("E2", "2026-08-09T18:43:00Z", "claude-fable-5", 900_000, 700_000, 100_000, 40_000),
      E("E3", "2026-08-09T18:48:00Z", "claude-fable-5", 600_000, 480_000, 60_000, 25_000),
      E("E4", "2026-08-09T18:55:00Z", "claude-fable-5", 500_000, 400_000, 50_000, 20_000),
      E("E5", "2026-08-09T19:10:00Z", "claude-fable-5", 300_000, 240_000, 30_000, 12_000),
      E("E6", "2026-08-09T19:25:00Z", "claude-fable-5", 250_000, 200_000, 25_000, 8_000),
      E("E7", "2026-08-09T19:40:00Z", "claude-fable-5", 100_000, 80_000, 10_000, 2_000),
      E("B1", "2026-08-09T18:50:34Z", "claude-fable-5", 0, 0, 0, 777),
      E("B2", "2026-08-09T18:30:00Z", "claude-fable-5", 0, 0, 0, 333),
      E("B3", "2026-08-09T20:00:00Z", "claude-fable-5", 0, 0, 0, 999),
      E("O1", "2026-08-09T18:05:00Z", "claude-fable-5", 400_000, 300_000, 40_000, 15_000),
      E("O2", "2026-08-09T18:25:00Z", "claude-fable-5", 0, 0, 0, 100),
      E("M1", "2026-08-09T18:57:00Z", "gpt-5.3-codex", 1_000_000, 0, 0, 100_000),
      E("M2", "2026-08-09T19:15:00Z", "claude-fable-5", 150_000, 0, 0, 10_000)
    ];
    await prisma.usageEvent.createMany({ data: events });
    const TR = (fromStatus: string | null, toStatus: string, batch: string, boundary: boolean, fixRounds: number, at: string) => ({
      fromStatus, toStatus, toBatch: batch, batchBoundary: boundary, fixRounds, observedAt: new Date(at)
    });
    const transitions = [
      TR(null, "building", "BL-AUDIT-V0", false, 0, "2026-08-09T18:00:00Z"),
      TR("building", "done", "BL-AUDIT-V0", false, 0, "2026-08-09T18:20:00Z"),
      TR("done", "planning", "BL-AUDIT-V1", true, 0, "2026-08-09T18:30:00Z"),
      TR("planning", "building", "BL-AUDIT-V1", false, 0, "2026-08-09T18:41:32Z"),
      TR("building", "verifying", "BL-AUDIT-V1", false, 0, "2026-08-09T18:50:34Z"),
      TR("verifying", "fixing", "BL-AUDIT-V1", false, 1, "2026-08-09T19:08:19Z"),
      TR("fixing", "reverifying", "BL-AUDIT-V1", false, 1, "2026-08-09T19:20:00Z"),
      TR("reverifying", "done", "BL-AUDIT-V1", false, 1, "2026-08-09T19:30:00Z")
    ];
    const nowMs = Date.parse("2026-08-09T20:00:00Z");

    // ---- independent derivation from raw values (no Generator literals) ----
    const ordered = [...transitions].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
    let ivs: { phase: string; batch: string; fixRounds: number; start: number; end: number; openEnded: boolean }[] = [];
    let open: (typeof ivs)[number] | null = null;
    for (const t of ordered) {
      if (t.batchBoundary) { ivs = []; open = null; }
      if (open) ivs.push({ ...open, end: t.observedAt.getTime(), openEnded: false });
      open = { phase: t.toStatus, batch: t.toBatch, fixRounds: t.fixRounds, start: t.observedAt.getTime(), end: t.observedAt.getTime(), openEnded: true };
    }
    if (open) {
      if (open.phase === "done") ivs.push({ ...open, end: open.start, openEnded: false });
      else ivs.push({ ...open, end: Math.max(nowMs, open.start), openEnded: true });
    }
    const expectedPhases = ivs.map((iv) => {
      let compute = 0, cost = 0, unpriced = 0;
      for (const e of events) {
        const at = e.occurredAt.getTime();
        if (at < iv.start || at >= iv.end) continue;
        const rowCompute = Math.max(0, e.inputTokens - e.cachedInputTokens) + e.outputTokens;
        compute += rowCompute;
        const dollars = estimateCost(e.model, {
          inputTokens: e.inputTokens, cachedInputTokens: e.cachedInputTokens,
          cacheWriteTokens: e.cacheWriteTokens, outputTokens: e.outputTokens
        }, MODEL_PRICES);
        if (dollars == null) unpriced += rowCompute; else cost += dollars;
      }
      return { ...iv, compute, cost, unpriced };
    });
    const expectedRework = expectedPhases.filter((p) => p.phase === "fixing" || p.phase === "reverifying");

    const rawSpy = vi.spyOn(prisma, "$queryRaw");
    const result = await getBatchCost(USER, { projectId: PROJECT, repoKey: null }, transitions, nowMs);
    expect(rawSpy).toHaveBeenCalledTimes(1); // single aggregate round-trip
    rawSpy.mockRestore();

    expect(result).not.toBeNull();
    expect(result!.batch).toBe("BL-AUDIT-V1");
    expect(result!.phases.map((p) => p.phase)).toEqual(expectedPhases.map((p) => p.phase));
    for (let i = 0; i < expectedPhases.length; i += 1) {
      const got = result!.phases[i], exp = expectedPhases[i];
      expect(got.computeTokens).toBe(exp.compute);
      expect(got.fixRounds).toBe(exp.fixRounds);
      expect(got.startIso).toBe(new Date(exp.start).toISOString());
      expect(got.endIso).toBe(new Date(exp.end).toISOString());
      expect(got.openEnded).toBe(exp.openEnded);
      expect(got.durationMs).toBe(Math.max(0, exp.end - exp.start));
      expect(got.costUsd).toBeCloseTo(exp.cost, 10);
      expect(got.unpricedComputeTokens).toBe(exp.unpriced);
    }
    const totalCompute = expectedPhases.reduce((s, p) => s + p.compute, 0);
    const totalCost = expectedPhases.reduce((s, p) => s + p.cost, 0);
    console.log(`F007 independent recompute: totalComputeTokens=${totalCompute} totalCostUsd=${totalCost.toFixed(6)}`);
    expect(result!.totalComputeTokens).toBe(totalCompute);
    expect(result!.totalCostUsd).toBeCloseTo(totalCost, 10);
    expect(result!.reworkComputeTokens).toBe(expectedRework.reduce((s, p) => s + p.compute, 0));
    expect(result!.reworkCostUsd).toBeCloseTo(expectedRework.reduce((s, p) => s + p.cost, 0), 10);
    expect(result!.windowStartIso).toBe(new Date(expectedPhases[0].start).toISOString());
    expect(result!.windowEndIso).toBe(new Date(expectedPhases.at(-1)!.end).toISOString());
    expect(result!.hasUnpricedUsage).toBe(expectedPhases.some((p) => p.unpriced > 0));
    expect(result!.unpricedComputeTokens).toBe(expectedPhases.reduce((s, p) => s + p.unpriced, 0));
    // closed batch → sentinel cache key at two different 30s quanta
    expect(batchCostCacheNowMs(transitions, nowMs)).toBe(CLOSED_BATCH_NOW_MS);
    expect(batchCostCacheNowMs(transitions, nowMs + 45_000)).toBe(CLOSED_BATCH_NOW_MS);
  });
});
