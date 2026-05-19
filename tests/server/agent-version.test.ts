import { describe, expect, it } from "vitest";
import { isDeviceOutdated, MIN_AGENT_SHA } from "@/server/agent-version";

describe("isDeviceOutdated", () => {
  it("MIN_AGENT_SHA is a 12-character hex string", () => {
    expect(MIN_AGENT_SHA).toMatch(/^[a-f0-9]{12}$/);
  });

  it("returns false when agentVersion matches MIN_AGENT_SHA", () => {
    expect(isDeviceOutdated(MIN_AGENT_SHA)).toBe(false);
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
