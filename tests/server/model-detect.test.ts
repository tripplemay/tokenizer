import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceInput, UsageEventInput } from "@/shared/usage";

const prismaMock = vi.hoisted(() => ({
  device: { upsert: vi.fn() },
  deviceToken: { update: vi.fn() },
  project: { upsert: vi.fn() },
  usageEvent: { createMany: vi.fn() },
  modelPrice: { findMany: vi.fn(), createMany: vi.fn() }
}));

vi.mock("@/server/db", () => ({ prisma: prismaMock }));

import { planModelPriceDetection, detectAndTrackUnpricedModels } from "@/server/pricing/detect";
import { ingestUsageEvents } from "@/server/ingest";

describe("planModelPriceDetection (pure)", () => {
  it("emits a detected row for a genuinely new model", () => {
    const rows = planModelPriceDetection(["brand-new-3-pro"], new Set());
    expect(rows).toEqual([{ modelKey: "brand-new-3-pro", status: "detected" }]);
  });

  it("skips models already priced by the static seed", () => {
    expect(planModelPriceDetection(["claude-opus-4-8", "gpt-5.5"], new Set())).toEqual([]);
  });

  it("skips keys already tracked in any status (no re-detect of rejected/pending)", () => {
    expect(planModelPriceDetection(["some-new-model"], new Set(["some-new-model"]))).toEqual([]);
  });

  it("auto-applies $0 for a -free model by convention", () => {
    const rows = planModelPriceDetection(["newvendor-flash-free"], new Set());
    expect(rows).toEqual([
      {
        modelKey: "newvendor-flash-free",
        status: "auto_applied",
        input: 0,
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
        source: "convention",
        confidence: "low",
        notes: "auto $0 via -free suffix convention"
      }
    ]);
  });

  it("normalizes (lowercase + date suffix) and dedupes within a batch", () => {
    const rows = planModelPriceDetection(
      ["New-Model-X-20260710", "new-model-x", "  new-model-x  "],
      new Set()
    );
    expect(rows).toEqual([{ modelKey: "new-model-x", status: "detected" }]);
  });

  it("ignores null / empty models", () => {
    expect(planModelPriceDetection([null, undefined, ""], new Set())).toEqual([]);
  });
});

describe("detectAndTrackUnpricedModels (DB glue)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not touch the DB when every model is seed-priced or null", async () => {
    const keys = await detectAndTrackUnpricedModels(["claude-opus-4-8", null, "gpt-5.5"]);
    expect(keys).toEqual([]);
    expect(prismaMock.modelPrice.findMany).not.toHaveBeenCalled();
    expect(prismaMock.modelPrice.createMany).not.toHaveBeenCalled();
  });

  it("creates detected/free rows for new keys and returns the ones needing a lookup", async () => {
    prismaMock.modelPrice.findMany.mockResolvedValue([{ modelKey: "already-tracked" }]);
    prismaMock.modelPrice.createMany.mockResolvedValue({ count: 2 });

    const keys = await detectAndTrackUnpricedModels([
      "brand-new-pro", // -> detected (needs lookup)
      "newvendor-flash-free", // -> auto $0
      "already-tracked", // -> skipped (existing row)
      "claude-opus-4-8" // -> skipped (seed)
    ]);

    const created = prismaMock.modelPrice.createMany.mock.calls[0][0].data;
    expect(created).toContainEqual({ modelKey: "brand-new-pro", status: "detected" });
    expect(created).toContainEqual(expect.objectContaining({ modelKey: "newvendor-flash-free", status: "auto_applied", input: 0 }));
    expect(created).toHaveLength(2);
    expect(prismaMock.modelPrice.createMany).toHaveBeenCalledWith({ data: created, skipDuplicates: true });
    // Only the detected key needs a lookup; the -free row is already priced.
    expect(keys).toEqual(["brand-new-pro"]);
  });
});

describe("ingestUsageEvents wiring", () => {
  const device: DeviceInput = { id: "dev-1", name: "Test Device" };
  function event(overrides: Partial<UsageEventInput> = {}): UsageEventInput {
    return { source: "claude-code", sourceEventId: "evt-1", occurredAt: "2026-07-10T00:00:00.000Z", workspacePath: "/w/app", inputTokens: 10, outputTokens: 5, ...overrides };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.device.upsert.mockResolvedValue({ id: device.id });
    prismaMock.deviceToken.update.mockResolvedValue({});
    prismaMock.project.upsert.mockResolvedValue({ id: "proj-1" });
    prismaMock.usageEvent.createMany.mockImplementation(({ data }: { data: unknown[] }) => Promise.resolve({ count: data.length }));
  });

  it("tracks a brand-new model seen during ingest and surfaces it on the result", async () => {
    prismaMock.modelPrice.findMany.mockResolvedValue([]);
    prismaMock.modelPrice.createMany.mockResolvedValue({ count: 1 });

    const result = await ingestUsageEvents([event({ model: "brand-new-4-turbo" })], device, "tok-1", "user-1");

    expect(result.inserted).toBe(1);
    expect(result.newModelKeys).toEqual(["brand-new-4-turbo"]);
    const created = prismaMock.modelPrice.createMany.mock.calls[0][0].data;
    expect(created).toEqual([{ modelKey: "brand-new-4-turbo", status: "detected" }]);
  });

  it("never fails the upload if detection throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    prismaMock.modelPrice.findMany.mockRejectedValue(new Error("db down"));

    const result = await ingestUsageEvents([event({ model: "another-new-model" })], device, "tok-1", "user-1");

    expect(result.inserted).toBe(1);
    expect(result.newModelKeys).toEqual([]);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
