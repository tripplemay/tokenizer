import { cache } from "react";
import { MIN_AGENT_FEATURE_VERSION } from "@/shared/agent-feature-version";
import { agentReleaseStanding, LATEST_AGENT_RELEASE } from "@/shared/agent-release-version";
import { prisma } from "./db";

// The install URLs — kept in code so it's easy to point staging at a
// different host during testing. Production is token.vpanel.cc.
export const INSTALL_HOST = "https://token.vpanel.cc";

export const INSTALL_COMMAND = `curl -fsSL ${INSTALL_HOST}/install.sh | bash`;

// Windows has no curl-to-shell equivalent: the scriptblock form is what lets
// a remotely fetched PowerShell script accept parameters.
export const WINDOWS_INSTALL_COMMAND =
  `& ([scriptblock]::Create((irm ${INSTALL_HOST}/install.ps1)))`;

export type InstallCommand = { id: string; label: string; command: string };

export const INSTALL_COMMANDS: InstallCommand[] = [
  { id: "posix", label: "macOS / Linux", command: INSTALL_COMMAND },
  { id: "windows", label: "Windows", command: WINDOWS_INSTALL_COMMAND }
];

export function isDeviceOutdated(featureVersion: number | null | undefined): boolean {
  // This is a capability check, not a strict release check. Null means the
  // client has not reported its compatibility level; release status handles
  // that separately as an unverified version rather than guessing.
  if (featureVersion == null) return false;
  return featureVersion < MIN_AGENT_FEATURE_VERSION;
}

type DeviceAgentUpdateStatusBase = {
  reported: string | null;
  behind: number | null;
  latest: string;
};

export type DeviceAgentUpdateStatus =
  | (DeviceAgentUpdateStatusBase & { kind: "upgrade-required" })
  | (DeviceAgentUpdateStatusBase & { kind: "latest" })
  | (DeviceAgentUpdateStatusBase & { kind: "ahead" })
  | (DeviceAgentUpdateStatusBase & { kind: "unknown" });

/**
 * Applies the two intentionally independent policies in order:
 *
 * 1. A device below the minimum capability must upgrade.
 * 2. Otherwise its immutable Agent release determines latest/behind/ahead.
 *
 * Missing release data is not silently classified as latest. It remains a
 * weak, device-level "unknown" prompt so legacy agents do not manufacture a
 * global upgrade incident while still being visible to the operator.
 */
export function deviceAgentUpdateStatus(input: {
  featureVersion: number | null | undefined;
  releaseVersion: string | null | undefined;
}): DeviceAgentUpdateStatus {
  const standing = agentReleaseStanding(input.releaseVersion);
  if (isDeviceOutdated(input.featureVersion) || standing.kind === "behind") {
    return { ...standing, kind: "upgrade-required" };
  }
  if (standing.kind === "latest") return { ...standing, kind: "latest" };
  if (standing.kind === "ahead") return { ...standing, kind: "ahead" };
  return { ...standing, kind: "unknown" };
}

export type AgentUpdateSummary = {
  outdatedCount: number;
  unknownCount: number;
  latestRelease: string;
};

// React 19 cache() — multiple calls per render dedup. Not unstable_cache
// because we want a device's just-completed upgrade to reflect on the
// next render (no stale 30s window).
export const getAgentUpdateSummary = cache(async (userId: string): Promise<AgentUpdateSummary> => {
  const devices = await prisma.device.findMany({
    where: { userId },
    select: { agentFeatureVersion: true, agentReleaseVersion: true },
  });
  let outdatedCount = 0;
  let unknownCount = 0;
  for (const device of devices) {
    const status = deviceAgentUpdateStatus({
      featureVersion: device.agentFeatureVersion,
      releaseVersion: device.agentReleaseVersion
    });
    if (status.kind === "upgrade-required") outdatedCount += 1;
    if (status.kind === "unknown") unknownCount += 1;
  }
  return { outdatedCount, unknownCount, latestRelease: LATEST_AGENT_RELEASE.version };
});

// Compatibility export for callers that only need the count. New UI should
// prefer getAgentUpdateSummary() so it can explain the exact target release.
export async function countOutdatedDevices(userId: string): Promise<number> {
  return (await getAgentUpdateSummary(userId)).outdatedCount;
}
