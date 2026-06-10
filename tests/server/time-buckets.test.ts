import { describe, expect, it } from "vitest";
import {
  bucketKeys,
  granularityForSpan,
  sqlBucket,
  utcToWallClock,
  wallClockToUtc,
} from "@/server/time-buckets";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("granularityForSpan", () => {
  it("uses hourly buckets for spans up to 48h", () => {
    expect(granularityForSpan(0, 6 * HOUR)).toBe("hour");
    expect(granularityForSpan(0, 48 * HOUR)).toBe("hour");
  });

  it("uses daily buckets between 48h and 92 days", () => {
    expect(granularityForSpan(0, 48 * HOUR + 1)).toBe("day");
    expect(granularityForSpan(0, 92 * DAY)).toBe("day");
  });

  it("uses weekly buckets beyond 92 days", () => {
    expect(granularityForSpan(0, 92 * DAY + 1)).toBe("week");
    expect(granularityForSpan(0, 365 * DAY)).toBe("week");
  });
});

describe("wallClockToUtc / utcToWallClock", () => {
  it("interprets a wall clock in Asia/Shanghai (UTC+8)", () => {
    // 2026-06-10 08:00 in Shanghai == 2026-06-10 00:00 UTC.
    expect(wallClockToUtc("2026-06-10T08:00", "Asia/Shanghai").toISOString()).toBe(
      "2026-06-10T00:00:00.000Z",
    );
  });

  it("interprets a wall clock in UTC unchanged", () => {
    expect(wallClockToUtc("2026-06-10T08:00", "UTC").toISOString()).toBe(
      "2026-06-10T08:00:00.000Z",
    );
  });

  it("round-trips an instant back to its Shanghai wall clock", () => {
    const wall = utcToWallClock(new Date("2026-06-10T00:00:00Z"), "Asia/Shanghai");
    expect(wall).toBe("2026-06-10T08:00");
  });

  it("returns Invalid Date for an unparseable string", () => {
    expect(Number.isNaN(wallClockToUtc("nonsense", "UTC").getTime())).toBe(true);
  });

  it("handles a post-DST-transition wall clock in a DST zone (New York, after spring-forward)", () => {
    // 2026-03-08 spring-forward in America/New_York: 02:00 EST -> 03:00 EDT.
    // 09:00 wall clock is unambiguously EDT (UTC-4) -> 13:00 UTC. The two-pass
    // probe must not apply the pre-transition EST (-5) offset.
    expect(wallClockToUtc("2026-03-08T09:00", "America/New_York").toISOString()).toBe(
      "2026-03-08T13:00:00.000Z",
    );
    // A winter wall clock is EST (UTC-5).
    expect(wallClockToUtc("2026-01-15T09:00", "America/New_York").toISOString()).toBe(
      "2026-01-15T14:00:00.000Z",
    );
  });
});

describe("bucketKeys", () => {
  it("generates hourly keys across a short Shanghai window", () => {
    const from = wallClockToUtc("2026-06-10T08:00", "Asia/Shanghai").getTime();
    const to = wallClockToUtc("2026-06-10T11:00", "Asia/Shanghai").getTime();
    expect(bucketKeys(from, to, "hour", "Asia/Shanghai")).toEqual([
      "2026-06-10T08:00",
      "2026-06-10T09:00",
      "2026-06-10T10:00",
      "2026-06-10T11:00",
    ]);
  });

  it("generates daily keys inclusive of both ends", () => {
    const from = wallClockToUtc("2026-06-08T00:00", "UTC").getTime();
    const to = wallClockToUtc("2026-06-10T23:00", "UTC").getTime();
    expect(bucketKeys(from, to, "day", "UTC")).toEqual([
      "2026-06-08",
      "2026-06-09",
      "2026-06-10",
    ]);
  });

  it("snaps weekly keys to ISO Mondays", () => {
    // 2026-06-10 is a Wednesday; its ISO week starts Monday 2026-06-08.
    const from = wallClockToUtc("2026-06-10T00:00", "UTC").getTime();
    const to = wallClockToUtc("2026-06-20T00:00", "UTC").getTime();
    expect(bucketKeys(from, to, "week", "UTC")).toEqual(["2026-06-08", "2026-06-15"]);
  });

  it("returns an empty array when to precedes from", () => {
    expect(bucketKeys(1000, 0, "hour", "UTC")).toEqual([]);
  });
});

describe("sqlBucket", () => {
  it("maps granularity to a Postgres date_trunc unit and to_char format", () => {
    expect(sqlBucket("hour")).toEqual({ unit: "hour", format: "YYYY-MM-DD\"T\"HH24:00" });
    expect(sqlBucket("day")).toEqual({ unit: "day", format: "YYYY-MM-DD" });
    expect(sqlBucket("week")).toEqual({ unit: "week", format: "YYYY-MM-DD" });
  });
});
