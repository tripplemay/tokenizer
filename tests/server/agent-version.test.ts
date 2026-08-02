import { describe, expect, it, vi } from "vitest";
import { CURRENT_AGENT_RELEASE_VERSION } from "@/shared/agent-release-version";
import {
  AGENT_FEATURE_VERSION,
  MIN_AGENT_FEATURE_VERSION,
  MIN_MODE_INTENT_AGENT_FEATURE_VERSION,
  MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION,
  requiredModeIntentAgentFeatureVersion
} from "@/shared/agent-feature-version";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/server/db", () => ({
  prisma: { device: { findMany: mocks.findMany } }
}));

import { deviceAgentUpdateStatus, getAgentUpdateSummary, isDeviceOutdated } from "@/server/agent-version";

describe("isDeviceOutdated", () => {
  it("advertises the 1.2.0 bridge-schema compatibility level", () => {
    expect(AGENT_FEATURE_VERSION).toBe(8);
    expect(MIN_AGENT_FEATURE_VERSION).toBe(8);
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

describe("mode intent capability notices", () => {
  it("keeps v1 intents at capability 4 while tool-bound intents require capability 8", () => {
    expect(MIN_MODE_INTENT_AGENT_FEATURE_VERSION).toBe(4);
    expect(MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION).toBe(8);
    expect(requiredModeIntentAgentFeatureVersion("agentUpgradeRequired")).toBe(
      MIN_MODE_INTENT_AGENT_FEATURE_VERSION
    );
    expect(requiredModeIntentAgentFeatureVersion("toolBindingAgentUpgradeRequired")).toBe(
      MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION
    );
  });
});

describe("strict Agent release update state", () => {
  it("does not equate a current capability level with a current release", () => {
    expect(deviceAgentUpdateStatus({ featureVersion: MIN_AGENT_FEATURE_VERSION, releaseVersion: null })).toMatchObject({
      kind: "unknown",
      latest: CURRENT_AGENT_RELEASE_VERSION
    });
  });

  it("requires an upgrade for missing capabilities or a known stale release", () => {
    expect(deviceAgentUpdateStatus({ featureVersion: MIN_AGENT_FEATURE_VERSION - 1, releaseVersion: CURRENT_AGENT_RELEASE_VERSION }))
      .toMatchObject({ kind: "upgrade-required", latest: CURRENT_AGENT_RELEASE_VERSION });
    expect(deviceAgentUpdateStatus({ featureVersion: MIN_AGENT_FEATURE_VERSION, releaseVersion: "0.9.9" }))
      .toMatchObject({ kind: "upgrade-required", reported: "0.9.9", latest: CURRENT_AGENT_RELEASE_VERSION });
  });

  it("requires the installed 1.1.0 / capability-7 Agent to upgrade to 1.2.0", () => {
    expect(deviceAgentUpdateStatus({ featureVersion: 7, releaseVersion: "1.1.0" })).toEqual({
      kind: "upgrade-required",
      reported: "1.1.0",
      behind: 1,
      latest: "1.2.0"
    });
  });

  it("does not direct a newer client to downgrade", () => {
    expect(deviceAgentUpdateStatus({ featureVersion: MIN_AGENT_FEATURE_VERSION, releaseVersion: CURRENT_AGENT_RELEASE_VERSION }))
      .toMatchObject({ kind: "latest" });
    expect(deviceAgentUpdateStatus({ featureVersion: MIN_AGENT_FEATURE_VERSION, releaseVersion: "9.0.0" }))
      .toMatchObject({ kind: "ahead", reported: "9.0.0" });
  });

  it("counts only known required upgrades in the global banner and keeps unverified devices visible", async () => {
    mocks.findMany.mockResolvedValueOnce([
      { agentFeatureVersion: MIN_AGENT_FEATURE_VERSION - 1, agentReleaseVersion: null },
      { agentFeatureVersion: MIN_AGENT_FEATURE_VERSION, agentReleaseVersion: "0.9.9" },
      { agentFeatureVersion: MIN_AGENT_FEATURE_VERSION, agentReleaseVersion: null },
      { agentFeatureVersion: MIN_AGENT_FEATURE_VERSION, agentReleaseVersion: CURRENT_AGENT_RELEASE_VERSION },
      { agentFeatureVersion: MIN_AGENT_FEATURE_VERSION, agentReleaseVersion: "9.0.0" }
    ]);

    await expect(getAgentUpdateSummary("user-for-summary")).resolves.toEqual({
      outdatedCount: 2,
      unknownCount: 1,
      latestRelease: CURRENT_AGENT_RELEASE_VERSION
    });
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { userId: "user-for-summary" },
      select: { agentFeatureVersion: true, agentReleaseVersion: true }
    });
  });
});
