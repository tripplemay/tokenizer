import { describe, expect, it } from "vitest";
import {
  HARNESS_BASE_MS,
  HARNESS_MAX_MS,
  initialHarnessBackoff,
  nextHarnessBackoff,
  type HarnessBackoffState
} from "../../src/cli/harness-backoff";

const noJitter = () => 0.5; // 0.85 + 0.5 * 0.3 = 1.0 —— 精确断言用

function failRounds(count: number, random: () => number): number[] {
  let state: HarnessBackoffState = initialHarnessBackoff;
  const delays: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const next = nextHarnessBackoff(state, true, random);
    state = next.state;
    delays.push(next.delayMs);
  }
  return delays;
}

describe("nextHarnessBackoff", () => {
  it("resets to the 60s base after a clean round", () => {
    const failed = nextHarnessBackoff(initialHarnessBackoff, true, noJitter);
    const clean = nextHarnessBackoff(failed.state, false, noJitter);
    expect(clean.delayMs).toBe(HARNESS_BASE_MS);
    expect(clean.state.consecutiveFailures).toBe(0);
  });

  it("doubles per consecutive failed round: 120/240/480/600s", () => {
    expect(failRounds(4, noJitter)).toEqual([120_000, 240_000, 480_000, 600_000]);
  });

  it("caps at 600s no matter how long the outage lasts", () => {
    expect(failRounds(10, noJitter).at(-1)).toBe(HARNESS_MAX_MS);
  });

  it("keeps jitter inside [0.85, 1.15] of the capped delay", () => {
    const low = nextHarnessBackoff(initialHarnessBackoff, true, () => 0);
    const high = nextHarnessBackoff(initialHarnessBackoff, true, () => 1);
    expect(low.delayMs).toBe(Math.round(120_000 * 0.85));
    expect(high.delayMs).toBe(Math.round(120_000 * 1.15));
    for (let i = 0; i < 50; i += 1) {
      const { delayMs } = nextHarnessBackoff(initialHarnessBackoff, true);
      expect(delayMs).toBeGreaterThanOrEqual(120_000 * 0.85 - 1);
      expect(delayMs).toBeLessThanOrEqual(120_000 * 1.15 + 1);
    }
  });

  it("backs off on issue rounds regardless of retryable classification", () => {
    // 调用方只传「本轮有无 issue」——non-retryable（如 local_error）同样进入
    // 退避，不再每 60s 重撞；本用例钉住这一约定的接口形态。
    const round = nextHarnessBackoff(initialHarnessBackoff, true, noJitter);
    expect(round.delayMs).toBeGreaterThan(HARNESS_BASE_MS);
  });
});
