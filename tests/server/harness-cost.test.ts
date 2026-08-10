import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: { usageEvent: { groupBy: vi.fn() }, harnessTransition: { findMany: vi.fn() } },
  getEffectivePrices: vi.fn()
}));
vi.mock("@/server/db", () => ({ prisma: mocks.prisma }));
vi.mock("../../src/server/model-prices", () => ({ getEffectivePrices: mocks.getEffectivePrices }));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn
}));

import {
  MAX_PHASE_INTERVALS,
  buildPhaseIntervals,
  getBatchCost,
  type TransitionLike
} from "../../src/server/harness-cost";
import { estimateCost } from "../../src/shared/model-pricing";

const NOW = new Date("2026-08-10T12:00:00.000Z");

function t(
  overrides: Partial<Omit<TransitionLike, "observedAt">> & { toStatus: string; observedAt: string }
): TransitionLike {
  return {
    fromStatus: "planning",
    toBatch: "BL-X",
    batchBoundary: false,
    fixRounds: 0,
    ...overrides,
    observedAt: new Date(overrides.observedAt)
  };
}

describe("buildPhaseIntervals（纯函数，无 prisma mock 依赖）", () => {
  it("returns empty for empty transitions", () => {
    expect(buildPhaseIntervals([], NOW)).toEqual([]);
  });

  it("closes the current phase as an open-ended interval at now", () => {
    const intervals = buildPhaseIntervals(
      [
        t({ fromStatus: null, toStatus: "building", observedAt: "2026-08-10T10:00:00.000Z" }),
        t({ toStatus: "verifying", observedAt: "2026-08-10T11:00:00.000Z" })
      ],
      NOW
    );
    expect(intervals).toHaveLength(2);
    expect(intervals[0]).toMatchObject({ phase: "building", openEnded: false });
    expect(intervals[0].end.toISOString()).toBe("2026-08-10T11:00:00.000Z");
    expect(intervals[1]).toMatchObject({ phase: "verifying", openEnded: true });
    expect(intervals[1].end.toISOString()).toBe(NOW.toISOString());
  });

  it("keeps every fixing⟷reverifying round as its own interval with fixRounds snapshots", () => {
    const seq = [
      t({ fromStatus: null, toStatus: "verifying", observedAt: "2026-08-10T08:00:00.000Z" }),
      t({ toStatus: "fixing", fixRounds: 1, observedAt: "2026-08-10T08:30:00.000Z" }),
      t({ toStatus: "reverifying", fixRounds: 1, observedAt: "2026-08-10T09:00:00.000Z" }),
      t({ toStatus: "fixing", fixRounds: 2, observedAt: "2026-08-10T09:30:00.000Z" }),
      t({ toStatus: "reverifying", fixRounds: 2, observedAt: "2026-08-10T10:00:00.000Z" }),
      t({ toStatus: "done", fixRounds: 2, observedAt: "2026-08-10T10:30:00.000Z" })
    ];
    const intervals = buildPhaseIntervals(seq, NOW);
    expect(intervals.map((i) => [i.phase, i.fixRounds])).toEqual([
      ["verifying", 0],
      ["fixing", 1],
      ["reverifying", 1],
      ["fixing", 2],
      ["reverifying", 2],
      ["done", 2]
    ]);
  });

  it("drops pre-boundary intervals when a batchBoundary row switches batches", () => {
    const intervals = buildPhaseIntervals(
      [
        t({ fromStatus: null, toStatus: "building", toBatch: "BL-OLD", observedAt: "2026-08-10T08:00:00.000Z" }),
        t({ toStatus: "done", toBatch: "BL-OLD", observedAt: "2026-08-10T09:00:00.000Z" }),
        t({ toStatus: "building", toBatch: "BL-NEW", batchBoundary: true, observedAt: "2026-08-10T10:00:00.000Z" })
      ],
      NOW
    );
    expect(intervals).toHaveLength(1);
    expect(intervals[0]).toMatchObject({ phase: "building", batch: "BL-NEW" });
    expect(intervals[0].start.toISOString()).toBe("2026-08-10T10:00:00.000Z");
  });

  it("merges oldest intervals beyond the cap instead of growing unbounded", () => {
    const seq: TransitionLike[] = [];
    for (let i = 0; i < MAX_PHASE_INTERVALS + 20; i += 1) {
      seq.push(
        t({
          fromStatus: i === 0 ? null : "fixing",
          toStatus: i % 2 === 0 ? "fixing" : "reverifying",
          fixRounds: Math.floor(i / 2),
          observedAt: new Date(Date.UTC(2026, 7, 10, 0, i)).toISOString()
        })
      );
    }
    const intervals = buildPhaseIntervals(seq, NOW);
    expect(intervals).toHaveLength(MAX_PHASE_INTERVALS);
    // 合并方向：最旧被吸收——首区间起点仍是全序列最早时刻，窗口无缝
    expect(intervals[0].start.toISOString()).toBe("2026-08-10T00:00:00.000Z");
    for (let i = 1; i < intervals.length; i += 1) {
      expect(intervals[i].start.getTime()).toBe(intervals[i - 1].end.getTime());
    }
  });

  it("uses strict UTC Date math across a day boundary", () => {
    const intervals = buildPhaseIntervals(
      [
        t({ fromStatus: null, toStatus: "building", observedAt: "2026-08-09T23:59:59.500Z" }),
        t({ toStatus: "verifying", observedAt: "2026-08-10T00:00:00.500Z" })
      ],
      NOW
    );
    expect(intervals[0].start.toISOString()).toBe("2026-08-09T23:59:59.500Z");
    expect(intervals[0].end.toISOString()).toBe("2026-08-10T00:00:00.500Z");
  });
});

describe("getBatchCost", () => {
  const PRICES = {
    "gpt-5.6-sol": { input: 2, cacheRead: 0.5, cacheWrite: 2.5, output: 8 }
  } as never;
  const SUMS = { inputTokens: 1_000_000, cachedInputTokens: 400_000, cacheWriteTokens: 100_000, outputTokens: 50_000 };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectivePrices.mockResolvedValue(PRICES);
    mocks.prisma.usageEvent.groupBy.mockResolvedValue([{ model: "gpt-5.6-sol", _sum: SUMS }]);
  });

  const TRANSITIONS = [
    t({ fromStatus: null, toStatus: "building", observedAt: "2026-08-10T10:00:00.000Z" }),
    t({ toStatus: "fixing", fixRounds: 1, observedAt: "2026-08-10T11:00:00.000Z" })
  ];

  it("matches the shared estimateCost pricing and billable compute wording exactly", async () => {
    const result = await getBatchCost("user-1", { projectId: "p1", repoKey: null }, TRANSITIONS, NOW.getTime());
    const expectedPerPhase = estimateCost("gpt-5.6-sol", SUMS, PRICES as never)!;
    expect(result).not.toBeNull();
    expect(result!.phases).toHaveLength(2);
    expect(result!.totalCostUsd).toBeCloseTo(expectedPerPhase * 2, 8);
    // compute = max(0, input − cached) + output —— 与 summaries.ts billableOf 一致
    expect(result!.totalComputeTokens).toBe((1_000_000 - 400_000 + 50_000) * 2);
    expect(result!.reworkCostUsd).toBeCloseTo(expectedPerPhase, 8);
    expect(result!.batch).toBe("BL-X");
  });

  it("queries [start, end) windows keyed by projectId when linked", async () => {
    await getBatchCost("user-1", { projectId: "p1", repoKey: "github.com/a/b" }, TRANSITIONS, NOW.getTime());
    const first = mocks.prisma.usageEvent.groupBy.mock.calls[0][0];
    expect(first.where).toMatchObject({ userId: "user-1", projectId: "p1" });
    expect(first.where.repoKey).toBeUndefined();
    expect(first.where.occurredAt).toEqual({
      gte: new Date("2026-08-10T10:00:00.000Z"),
      lt: new Date("2026-08-10T11:00:00.000Z")
    });
  });

  it("falls back to repoKey when projectId is null", async () => {
    await getBatchCost("user-1", { projectId: null, repoKey: "github.com/a/b" }, TRANSITIONS, NOW.getTime());
    expect(mocks.prisma.usageEvent.groupBy.mock.calls[0][0].where).toMatchObject({ repoKey: "github.com/a/b" });
  });

  it("returns null without touching the database when both link keys are null", async () => {
    const result = await getBatchCost("user-1", { projectId: null, repoKey: null }, TRANSITIONS, NOW.getTime());
    expect(result).toBeNull();
    expect(mocks.prisma.usageEvent.groupBy).not.toHaveBeenCalled();
  });

  it("returns null for empty transitions without touching the database", async () => {
    const result = await getBatchCost("user-1", { projectId: "p1", repoKey: null }, [], NOW.getTime());
    expect(result).toBeNull();
    expect(mocks.prisma.usageEvent.groupBy).not.toHaveBeenCalled();
  });
});
