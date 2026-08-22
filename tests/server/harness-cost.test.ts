import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: { $queryRaw: vi.fn(), harnessTransition: { findMany: vi.fn() } },
  getEffectivePrices: vi.fn(),
  cacheStores: [] as Array<Map<string, unknown>>
}));
vi.mock("@/server/db", () => ({ prisma: mocks.prisma }));
vi.mock("../../src/server/model-prices", () => ({ getEffectivePrices: mocks.getEffectivePrices }));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => {
    const store = new Map<string, unknown>();
    mocks.cacheStores.push(store);
    return (...args: unknown[]) => {
      const key = JSON.stringify(args);
      if (!store.has(key)) store.set(key, Promise.resolve(fn(...args)));
      return store.get(key);
    };
  }
}));

import {
  MAX_PHASE_INTERVALS,
  CLOSED_BATCH_NOW_MS,
  batchCostCacheNowMs,
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

  it("closes a terminal done phase at zero width so a finished batch stops accruing (F-31 fix)", () => {
    const intervals = buildPhaseIntervals(
      [
        t({ fromStatus: null, toStatus: "verifying", observedAt: "2026-08-10T10:00:00.000Z" }),
        t({ toStatus: "done", observedAt: "2026-08-10T11:00:00.000Z" })
      ],
      NOW
    );
    const done = intervals.at(-1)!;
    expect(done.phase).toBe("done");
    expect(done.openEnded).toBe(false);
    expect(done.end.toISOString()).toBe("2026-08-10T11:00:00.000Z");
    // 整批窗口终点 = done 时刻，不随 now 延伸
    expect(done.end.getTime()).toBe(done.start.getTime());
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

  it("sorts out-of-order transitions before constructing contiguous intervals", () => {
    const intervals = buildPhaseIntervals(
      [
        t({ toStatus: "verifying", observedAt: "2026-08-10T11:00:00.000Z" }),
        t({ fromStatus: null, toStatus: "building", observedAt: "2026-08-10T10:00:00.000Z" })
      ],
      NOW
    );
    expect(intervals.map((interval) => interval.phase)).toEqual(["building", "verifying"]);
    expect(intervals[0].end.getTime()).toBe(intervals[1].start.getTime());
  });

  it("keeps same-millisecond transitions deterministic without negative windows", () => {
    const intervals = buildPhaseIntervals(
      [
        t({ fromStatus: null, toStatus: "building", observedAt: "2026-08-10T10:00:00.000Z" }),
        t({ toStatus: "verifying", observedAt: "2026-08-10T11:00:00.000Z" }),
        t({ toStatus: "fixing", fixRounds: 1, observedAt: "2026-08-10T11:00:00.000Z" })
      ],
      NOW
    );
    expect(intervals.map((interval) => interval.phase)).toEqual(["building", "verifying", "fixing"]);
    expect(intervals[1].end.getTime() - intervals[1].start.getTime()).toBe(0);
    expect(intervals.every((interval) => interval.end.getTime() >= interval.start.getTime())).toBe(true);
  });

  it("clamps an open interval when the caller clock is behind its transition", () => {
    const future = t({ fromStatus: null, toStatus: "building", observedAt: "2026-08-10T13:00:00.000Z" });
    const [interval] = buildPhaseIntervals([future], NOW);
    expect(interval.start.toISOString()).toBe("2026-08-10T13:00:00.000Z");
    expect(interval.end.toISOString()).toBe(interval.start.toISOString());
    expect(interval.openEnded).toBe(true);
  });
});

describe("getBatchCost", () => {
  const PRICES = {
    "gpt-5.6-sol": { input: 2, cacheRead: 0.5, cacheWrite: 2.5, output: 8 }
  } as never;
  const SUMS = { inputTokens: 1_000_000, cachedInputTokens: 400_000, cacheWriteTokens: 100_000, outputTokens: 50_000 };

  beforeEach(() => {
    vi.clearAllMocks();
    for (const store of mocks.cacheStores) store.clear();
    mocks.getEffectivePrices.mockResolvedValue(PRICES);
    mocks.prisma.$queryRaw.mockResolvedValue([
      { intervalIdx: 0n, model: "gpt-5.6-sol", ...SUMS },
      { intervalIdx: 1n, model: "gpt-5.6-sol", ...SUMS }
    ]);
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
    // 缓存反序列化安全：返回值时间字段必须已是 ISO 串而非 Date
    expect(typeof result!.windowStartIso).toBe("string");
    expect(result!.phases[0].startIso).toBe("2026-08-10T10:00:00.000Z");
    expect(result!.phases[1].durationMs).toBe(NOW.getTime() - new Date("2026-08-10T11:00:00.000Z").getTime());
    expect(result).toEqual({
      batch: "BL-X",
      totalCostUsd: 3.7,
      totalComputeTokens: 1_300_000,
      phases: [
        {
          phase: "building",
          batch: "BL-X",
          fixRounds: 0,
          startIso: "2026-08-10T10:00:00.000Z",
          endIso: "2026-08-10T11:00:00.000Z",
          openEnded: false,
          durationMs: 3_600_000,
          computeTokens: 650_000,
          costUsd: 1.85,
          unpricedComputeTokens: 0
        },
        {
          phase: "fixing",
          batch: "BL-X",
          fixRounds: 1,
          startIso: "2026-08-10T11:00:00.000Z",
          endIso: "2026-08-10T12:00:00.000Z",
          openEnded: true,
          durationMs: 3_600_000,
          computeTokens: 650_000,
          costUsd: 1.85,
          unpricedComputeTokens: 0
        }
      ],
      reworkCostUsd: 1.85,
      reworkComputeTokens: 650_000,
      hasUnpricedUsage: false,
      unpricedComputeTokens: 0,
      windowStartIso: "2026-08-10T10:00:00.000Z",
      windowEndIso: "2026-08-10T12:00:00.000Z"
    });
  });

  it("splits unpriced-model usage into disclosed unpriced tokens instead of silently dropping it", async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([
      { intervalIdx: 0n, model: "gpt-5.6-sol", ...SUMS },
      { intervalIdx: 0n, model: "some-unpriced-model", inputTokens: 100_000n, cachedInputTokens: 0n, cacheWriteTokens: 0n, outputTokens: 20_000n },
      { intervalIdx: 1n, model: "gpt-5.6-sol", ...SUMS },
      { intervalIdx: 1n, model: "some-unpriced-model", inputTokens: 100_000n, cachedInputTokens: 0n, cacheWriteTokens: 0n, outputTokens: 20_000n }
    ]);
    const result = await getBatchCost("user-1", { projectId: "p1", repoKey: null }, TRANSITIONS, NOW.getTime());
    const priced = estimateCost("gpt-5.6-sol", SUMS, PRICES as never)!;
    // costUsd 只含已定价模型；unpriced tokens 显式披露且仍计入 compute
    expect(result!.totalCostUsd).toBeCloseTo(priced * 2, 8);
    expect(result!.hasUnpricedUsage).toBe(true);
    expect(result!.unpricedComputeTokens).toBe(120_000 * 2);
    expect(result!.totalComputeTokens).toBe((1_000_000 - 400_000 + 50_000 + 120_000) * 2);
    expect(result!.phases[0].unpricedComputeTokens).toBe(120_000);
  });

  it("uses one [start, end) range-join query keyed by projectId for every interval", async () => {
    await getBatchCost("user-1", { projectId: "p1", repoKey: "github.com/a/b" }, TRANSITIONS, NOW.getTime());
    expect(mocks.prisma.$queryRaw).toHaveBeenCalledOnce();
    const query = mocks.prisma.$queryRaw.mock.calls[0][0] as { text: string; values: unknown[] };
    expect(query.text).toContain('usage."occurredAt" >= intervals."startAt"');
    expect(query.text).toContain('usage."occurredAt" < intervals."endAt"');
    expect(query.text).toContain('usage."projectId" =');
    expect(query.text).not.toContain('usage."repoKey" =');
    expect(query.values).toEqual(expect.arrayContaining(["user-1", "p1"]));
  });

  it("falls back to repoKey when projectId is null", async () => {
    await getBatchCost("user-1", { projectId: null, repoKey: "github.com/a/b" }, TRANSITIONS, NOW.getTime());
    const query = mocks.prisma.$queryRaw.mock.calls[0][0] as { text: string; values: unknown[] };
    expect(query.text).toContain('usage."repoKey" =');
    expect(query.values).toContain("github.com/a/b");
  });

  it("returns null without touching the database when both link keys are null", async () => {
    const result = await getBatchCost("user-1", { projectId: null, repoKey: null }, TRANSITIONS, NOW.getTime());
    expect(result).toBeNull();
    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("returns null for empty transitions without touching the database", async () => {
    const result = await getBatchCost("user-1", { projectId: "p1", repoKey: null }, [], NOW.getTime());
    expect(result).toBeNull();
    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("normalizes closed batches to one permanent cache key across 30-second windows", async () => {
    const closed = [
      t({ fromStatus: null, toStatus: "building", observedAt: "2026-08-10T10:00:00.000Z" }),
      t({ toStatus: "done", observedAt: "2026-08-10T11:00:00.000Z" })
    ];
    expect(batchCostCacheNowMs(closed, NOW.getTime())).toBe(CLOSED_BATCH_NOW_MS);
    expect(batchCostCacheNowMs(closed, NOW.getTime() + 60_000)).toBe(CLOSED_BATCH_NOW_MS);

    await getBatchCost("closed-user", { projectId: "p1", repoKey: null }, closed, NOW.getTime());
    await getBatchCost("closed-user", { projectId: "p1", repoKey: null }, closed, NOW.getTime() + 60_000);
    expect(mocks.prisma.$queryRaw).toHaveBeenCalledOnce();
  });

  it("keeps active batches on distinct quantized-window cache keys", async () => {
    expect(batchCostCacheNowMs(TRANSITIONS, NOW.getTime())).toBe(NOW.getTime());
    expect(batchCostCacheNowMs(TRANSITIONS, NOW.getTime() + 60_000)).toBe(NOW.getTime() + 60_000);

    await getBatchCost("active-user", { projectId: "p1", repoKey: null }, TRANSITIONS, NOW.getTime());
    await getBatchCost("active-user", { projectId: "p1", repoKey: null }, TRANSITIONS, NOW.getTime() + 60_000);
    expect(mocks.prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
