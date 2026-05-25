import { describe, expect, it } from "vitest";
import { localDateRange } from "@/server/summaries";

describe("localDateRange", () => {
  it("returns exactly `days` ascending yyyy-mm-dd strings", () => {
    const out = localDateRange("UTC", 7, new Date("2026-05-25T12:00:00Z"));
    expect(out).toEqual([
      "2026-05-19",
      "2026-05-20",
      "2026-05-21",
      "2026-05-22",
      "2026-05-23",
      "2026-05-24",
      "2026-05-25",
    ]);
  });

  it("ends on today_local for Asia/Shanghai when UTC clock is still on previous day", () => {
    // 2026-05-25T16:30Z = 2026-05-26 00:30 in Asia/Shanghai (UTC+8).
    // The Shanghai user expects "today" = 2026-05-26 on the chart.
    const out = localDateRange("Asia/Shanghai", 3, new Date("2026-05-25T16:30:00Z"));
    expect(out).toEqual(["2026-05-24", "2026-05-25", "2026-05-26"]);
  });

  it("ends on today_local for America/Los_Angeles when UTC clock has advanced into next day", () => {
    // 2026-05-25T03:00Z = 2026-05-24 20:00 in America/Los_Angeles (PDT, UTC-7).
    const out = localDateRange("America/Los_Angeles", 3, new Date("2026-05-25T03:00:00Z"));
    expect(out).toEqual(["2026-05-22", "2026-05-23", "2026-05-24"]);
  });

  it("crosses month and year boundaries correctly", () => {
    const out = localDateRange("UTC", 4, new Date("2026-01-02T12:00:00Z"));
    expect(out).toEqual(["2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"]);
  });

  it("returns an empty array for non-positive day counts", () => {
    expect(localDateRange("UTC", 0, new Date("2026-05-25T12:00:00Z"))).toEqual([]);
    expect(localDateRange("UTC", -3, new Date("2026-05-25T12:00:00Z"))).toEqual([]);
  });

  it("is DST-safe (whole-day arithmetic in UTC ignores DST shifts in target tz)", () => {
    // America/Los_Angeles DST spring-forward in 2026: 2026-03-08.
    // The local calendar still increments by exactly one day each step.
    const out = localDateRange("America/Los_Angeles", 3, new Date("2026-03-09T12:00:00Z"));
    // 2026-03-09T12:00Z = 05:00 PDT → "today" = 2026-03-09
    expect(out).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
  });
});
