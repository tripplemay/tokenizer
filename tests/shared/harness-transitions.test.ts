import { describe, expect, it } from "vitest";
import {
  TRANSITION_LOW_PRECISION_MS,
  buildTransitionTimeline,
  type TransitionRow
} from "../../src/shared/harness-transitions";

const T0 = Date.parse("2026-08-09T10:00:00.000Z");
const MIN = 60_000;

function row(overrides: Partial<TransitionRow>): TransitionRow {
  return {
    fromStatus: "planning",
    toStatus: "building",
    fromBatch: "BL-A",
    toBatch: "BL-A",
    batchBoundary: false,
    fixRounds: 0,
    observedAfter: new Date(T0 - MIN),
    observedAt: new Date(T0),
    ...overrides
  };
}

const NOW = new Date(T0 + 60 * MIN);

describe("buildTransitionTimeline", () => {
  it("returns nothing for an empty log", () => {
    expect(buildTransitionTimeline([], { now: NOW, reportIsFresh: true })).toEqual([]);
  });

  it("groups by batch and computes adjacent durations", () => {
    const rows = [
      row({ fromStatus: null, toStatus: "building", observedAfter: null, observedAt: new Date(T0) }),
      row({ fromStatus: "building", toStatus: "verifying", observedAt: new Date(T0 + 10 * MIN), observedAfter: new Date(T0 + 9 * MIN) }),
      row({ fromStatus: "verifying", toStatus: "done", observedAt: new Date(T0 + 15 * MIN), observedAfter: new Date(T0 + 14 * MIN) })
    ];
    const groups = buildTransitionTimeline(rows, { now: NOW, reportIsFresh: true });
    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group.batch).toBe("BL-A");
    expect(group.segments.map((s) => s.phase)).toEqual(["building", "verifying", "done"]);
    expect(group.segments[0].durationMs).toBe(10 * MIN);
    expect(group.segments[0].initialObservation).toBe(true);
    expect(group.segments[1].durationMs).toBe(5 * MIN);
    // 初始观测段不入聚合；verifying 5 分钟 + done 进行中（fresh）
    expect(group.segments[2].end).toBeNull();
    expect(group.segments[2].durationMs).toBe(45 * MIN);
    expect(group.totalMs).toBe(5 * MIN + 45 * MIN);
  });

  it("only times the in-flight tail segment when the report is fresh", () => {
    const rows = [row({ fromStatus: "planning", toStatus: "building" })];
    const fresh = buildTransitionTimeline(rows, { now: NOW, reportIsFresh: true });
    expect(fresh[0].segments[0].durationMs).toBe(60 * MIN);
    const stale = buildTransitionTimeline(rows, { now: NOW, reportIsFresh: false });
    expect(stale[0].segments[0].durationMs).toBeNull();
    expect(stale[0].totalMs).toBeNull();
  });

  it("splits fixing⟷reverifying rounds into distinct segments with fixRounds", () => {
    const rows = [
      row({ fromStatus: "verifying", toStatus: "fixing", fixRounds: 1, observedAt: new Date(T0) }),
      row({ fromStatus: "fixing", toStatus: "reverifying", fixRounds: 1, observedAt: new Date(T0 + 5 * MIN), observedAfter: new Date(T0 + 4 * MIN) }),
      row({ fromStatus: "reverifying", toStatus: "fixing", fixRounds: 2, observedAt: new Date(T0 + 8 * MIN), observedAfter: new Date(T0 + 7 * MIN) }),
      row({ fromStatus: "fixing", toStatus: "reverifying", fixRounds: 2, observedAt: new Date(T0 + 12 * MIN), observedAfter: new Date(T0 + 11 * MIN) })
    ];
    const [group] = buildTransitionTimeline(rows, { now: NOW, reportIsFresh: false });
    expect(group.segments.map((s) => [s.phase, s.fixRounds, s.durationMs])).toEqual([
      ["fixing", 1, 5 * MIN],
      ["reverifying", 1, 3 * MIN],
      ["fixing", 2, 4 * MIN],
      ["reverifying", 2, null]
    ]);
    expect(group.totalMs).toBe(12 * MIN);
  });

  it("cuts aggregation at batch boundaries", () => {
    const rows = [
      row({ fromStatus: "planning", toStatus: "building", observedAt: new Date(T0) }),
      row({
        fromStatus: "done",
        toStatus: "planning",
        fromBatch: "BL-A",
        toBatch: "BL-B",
        batchBoundary: true,
        observedAt: new Date(T0 + 20 * MIN),
        observedAfter: new Date(T0 + 19 * MIN)
      }),
      row({ fromStatus: "planning", toStatus: "building", fromBatch: "BL-B", toBatch: "BL-B", observedAt: new Date(T0 + 25 * MIN), observedAfter: new Date(T0 + 24 * MIN) })
    ];
    const groups = buildTransitionTimeline(rows, { now: NOW, reportIsFresh: false });
    expect(groups.map((g) => g.batch)).toEqual(["BL-A", "BL-B"]);
    // BL-A 的 building 终止于边界行时刻；耗时不跨组聚合
    expect(groups[0].segments[0].durationMs).toBe(20 * MIN);
    expect(groups[0].totalMs).toBe(20 * MIN);
    expect(groups[1].segments.map((s) => s.phase)).toEqual(["planning", "building"]);
    expect(groups[1].totalMs).toBe(5 * MIN);
  });

  it("flags low-precision observation gaps and tolerates compressed edges", () => {
    const rows = [
      row({
        fromStatus: "building",
        toStatus: "fixing", // 非法定相邻边：轮询间隔穿越了 verifying
        observedAt: new Date(T0),
        observedAfter: new Date(T0 - TRANSITION_LOW_PRECISION_MS - MIN)
      })
    ];
    const [group] = buildTransitionTimeline(rows, { now: NOW, reportIsFresh: false });
    expect(group.segments[0].lowPrecision).toBe(true);
    expect(group.segments[0].nonAdjacent).toBe(true);
  });

  it("stays a pure function over serialized dates and never throws on garbage timestamps", () => {
    const rows = [
      row({ observedAt: "2026-08-09T10:00:00.000Z", observedAfter: "2026-08-09T09:59:00.000Z" }),
      row({ observedAt: "not-a-date" })
    ];
    const groups = buildTransitionTimeline(rows, { now: NOW, reportIsFresh: false });
    expect(groups).toHaveLength(1);
    expect(groups[0].segments).toHaveLength(1);
  });
});
