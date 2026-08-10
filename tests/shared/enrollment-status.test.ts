import { describe, expect, it } from "vitest";
import { enrollmentPollDelayMs, isEnrollmentClaimed } from "@/shared/enrollment-status";

describe("enrollment claim status", () => {
  it("does not claim this flow when an unrelated new device exists", () => {
    const unrelatedNewDevice = { deviceId: "device-from-another-flow", name: "Other machine" };
    const thisEnrollment = {
      usedAt: null,
      usedById: null,
      deviceName: null,
      expiresAt: "2026-08-10T18:00:00.000Z"
    };

    expect(unrelatedNewDevice.deviceId).not.toBe(thisEnrollment.usedById);
    expect(isEnrollmentClaimed(thisEnrollment)).toBe(false);
  });

  it("claims only when this enrollment has a non-empty usedById", () => {
    expect(isEnrollmentClaimed({ usedById: "device-1" })).toBe(true);
    expect(isEnrollmentClaimed({ usedById: "" })).toBe(false);
    expect(isEnrollmentClaimed({ usedById: null })).toBe(false);
  });
});

describe("enrollment polling backoff", () => {
  it("backs off exponentially and caps the delay", () => {
    expect([0, 1, 2, 3, 4, 5].map(enrollmentPollDelayMs)).toEqual([1000, 2000, 4000, 8000, 10000, 10000]);
    expect(enrollmentPollDelayMs(-1)).toBe(1000);
  });
});
