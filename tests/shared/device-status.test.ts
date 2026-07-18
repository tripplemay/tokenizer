import { describe, expect, it } from "vitest";
import {
  DEVICE_ONLINE_MS,
  DEVICE_STALE_MS,
  DEVICE_STATUS_COLOR,
  deviceStatusBadge,
  deviceStatusKey
} from "@/shared/device-status";

// A fixed reference "now" keeps every case deterministic — the whole point of
// lifting Date.now() out of the status logic and into an explicit argument.
const NOW = 1_700_000_000_000;
const iso = (offsetMs: number) => new Date(NOW - offsetMs).toISOString();
const MIN = 60 * 1000;

describe("deviceStatusKey", () => {
  it("returns neverSeen when lastSeenAt is missing", () => {
    expect(deviceStatusKey(null, NOW)).toBe("neverSeen");
    expect(deviceStatusKey(undefined, NOW)).toBe("neverSeen");
  });

  it("returns online within the online window", () => {
    expect(deviceStatusKey(iso(0), NOW)).toBe("online");
    expect(deviceStatusKey(iso(5 * MIN), NOW)).toBe("online");
    expect(deviceStatusKey(iso(DEVICE_ONLINE_MS - 1), NOW)).toBe("online");
  });

  it("treats the online boundary as stale (age === threshold is not < threshold)", () => {
    expect(deviceStatusKey(iso(DEVICE_ONLINE_MS), NOW)).toBe("stale");
  });

  it("returns stale between the online and stale thresholds", () => {
    expect(deviceStatusKey(iso(45 * MIN), NOW)).toBe("stale");
    expect(deviceStatusKey(iso(DEVICE_STALE_MS - 1), NOW)).toBe("stale");
  });

  it("returns offline at and beyond the stale threshold", () => {
    expect(deviceStatusKey(iso(DEVICE_STALE_MS), NOW)).toBe("offline");
    expect(deviceStatusKey(iso(3 * 60 * MIN), NOW)).toBe("offline");
  });

  it("treats a future lastSeenAt (clock skew) as online rather than crashing", () => {
    expect(deviceStatusKey(iso(-5 * MIN), NOW)).toBe("online");
  });

  it("recomputes as now advances — a device drifts online -> stale -> offline", () => {
    const seenAt = iso(0);
    expect(deviceStatusKey(seenAt, NOW)).toBe("online");
    expect(deviceStatusKey(seenAt, NOW + 30 * MIN)).toBe("stale");
    expect(deviceStatusKey(seenAt, NOW + 90 * MIN)).toBe("offline");
  });
});

describe("deviceStatusBadge", () => {
  it("pairs the status key with its color class", () => {
    const badge = deviceStatusBadge(iso(5 * MIN), NOW);
    expect(badge.key).toBe("online");
    expect(badge.color).toBe(DEVICE_STATUS_COLOR.online);
  });

  it("exposes a color for every status key", () => {
    for (const key of ["online", "stale", "offline", "neverSeen"] as const) {
      expect(DEVICE_STATUS_COLOR[key]).toBeTruthy();
    }
  });
});
