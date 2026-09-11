import { describe, expect, it } from "vitest";
import { getQuotaFreshness, getQuotaRemaining, parseQuotaTimestamp, QUOTA_FRESHNESS_MS } from "@/shared/quota-presentation";

const now = Date.parse("2026-09-11T00:00:00.000Z");
const timestamp = (age: number) => new Date(now - age).toISOString();

describe("quota window freshness", () => {
  it.each([
    [0, false],
    [QUOTA_FRESHNESS_MS - 1, false],
    [QUOTA_FRESHNESS_MS, false],
    [QUOTA_FRESHNESS_MS + 1, true],
    [-1, true]
  ])("checks capture age %s independently at the exact boundary", (age, pendingRefresh) => {
    expect(getQuotaFreshness({ capturedAt: timestamp(age) }, now).pendingRefresh).toBe(pendingRefresh);
  });

  it.each([
    [null, false],
    [undefined, false],
    [timestamp(-1), false],
    [timestamp(0), true],
    [timestamp(1), true],
    ["not-a-date", true],
    ["", true],
    ["2026-02-30T00:00:00Z", true]
  ])("checks reset %s without inferring a replenished balance", (resetsAt, pendingRefresh) => {
    expect(getQuotaFreshness({ capturedAt: timestamp(0), resetsAt }, now).pendingRefresh).toBe(pendingRefresh);
  });

  it.each([undefined, null, "", "invalid", "2026-02-30T00:00:00Z", "2026-01-01", "2026-09-10T24:00:00Z", 0])("fails closed for capture timestamp %s", (capturedAt) => {
    expect(getQuotaFreshness({ capturedAt }, now)).toMatchObject({ capturedAt: null, pendingRefresh: true });
  });

  it("accepts UTC and explicit timezone ISO timestamps with equal meaning", () => {
    expect(parseQuotaTimestamp("2026-09-11T08:00:00+08:00")).toBe(now);
    expect(parseQuotaTimestamp("2026-09-11T00:00:00Z")).toBe(now);
    expect(parseQuotaTimestamp("2026-09-11T00:00:00.001Z")).toBe(now + 1);
  });
});

describe("quota remaining values", () => {
  it.each([null, undefined, NaN, Infinity, -Infinity, -0.01, 1.01, "0.5"])("shows unknown for invalid utilization %s", (utilization) => {
    expect(getQuotaRemaining(utilization, false)).toBeNull();
  });

  it.each([[0, 100], [0.25, 75], [1, 0]])("renders utilization %s only while fresh", (utilization, remaining) => {
    expect(getQuotaRemaining(utilization, false)).toBe(remaining);
    expect(getQuotaRemaining(utilization, true)).toBeNull();
  });
});
