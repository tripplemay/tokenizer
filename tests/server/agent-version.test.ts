import { describe, expect, it } from "vitest";
import { ACCEPTABLE_AGENT_SHAS, isDeviceOutdated } from "@/server/agent-version";

describe("isDeviceOutdated", () => {
  it("ACCEPTABLE_AGENT_SHAS is non-empty and every entry is a 12-char hex string", () => {
    expect(ACCEPTABLE_AGENT_SHAS.size).toBeGreaterThan(0);
    for (const sha of ACCEPTABLE_AGENT_SHAS) {
      expect(sha).toMatch(/^[a-f0-9]{12}$/);
    }
  });

  it("returns false for every SHA in ACCEPTABLE_AGENT_SHAS", () => {
    for (const sha of ACCEPTABLE_AGENT_SHAS) {
      expect(isDeviceOutdated(sha)).toBe(false);
    }
  });

  it("returns true for any other non-empty SHA", () => {
    expect(isDeviceOutdated("aaaaaaaaaaaa")).toBe(true);
    expect(isDeviceOutdated("af8708390285")).toBe(true);
    expect(isDeviceOutdated("d31acc94822a")).toBe(true);
  });

  it("returns false for null, undefined, and empty string", () => {
    expect(isDeviceOutdated(null)).toBe(false);
    expect(isDeviceOutdated(undefined)).toBe(false);
    expect(isDeviceOutdated("")).toBe(false);
  });
});
