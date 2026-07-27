import { describe, expect, it } from "vitest";
import { isDeviceOutdated } from "@/server/agent-version";
import { AGENT_FEATURE_VERSION, MIN_AGENT_FEATURE_VERSION } from "@/shared/agent-feature-version";

describe("isDeviceOutdated", () => {
  it("advertises the F004 mode-intent capability level", () => {
    expect(AGENT_FEATURE_VERSION).toBe(4);
    expect(MIN_AGENT_FEATURE_VERSION).toBe(4);
  });

  it("AGENT_FEATURE_VERSION and MIN_AGENT_FEATURE_VERSION are positive integers", () => {
    expect(Number.isInteger(AGENT_FEATURE_VERSION)).toBe(true);
    expect(AGENT_FEATURE_VERSION).toBeGreaterThan(0);
    expect(Number.isInteger(MIN_AGENT_FEATURE_VERSION)).toBe(true);
    expect(MIN_AGENT_FEATURE_VERSION).toBeGreaterThan(0);
  });

  it("agent build's own version is at least the minimum", () => {
    // Guard against the SDK shipping with an AGENT_FEATURE_VERSION that the
    // server would immediately flag as outdated — a release-time foot-gun.
    expect(AGENT_FEATURE_VERSION).toBeGreaterThanOrEqual(MIN_AGENT_FEATURE_VERSION);
  });

  it("returns false when featureVersion equals MIN_AGENT_FEATURE_VERSION", () => {
    expect(isDeviceOutdated(MIN_AGENT_FEATURE_VERSION)).toBe(false);
  });

  it("returns false when featureVersion exceeds MIN_AGENT_FEATURE_VERSION", () => {
    expect(isDeviceOutdated(MIN_AGENT_FEATURE_VERSION + 1)).toBe(false);
    expect(isDeviceOutdated(MIN_AGENT_FEATURE_VERSION + 100)).toBe(false);
  });

  it("returns true when featureVersion is below MIN_AGENT_FEATURE_VERSION", () => {
    expect(isDeviceOutdated(MIN_AGENT_FEATURE_VERSION - 1)).toBe(true);
    expect(isDeviceOutdated(0)).toBe(true);
  });

  it("returns false for null and undefined (device hasn't reported yet)", () => {
    expect(isDeviceOutdated(null)).toBe(false);
    expect(isDeviceOutdated(undefined)).toBe(false);
  });
});
