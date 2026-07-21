import { cache } from "react";
import { MIN_AGENT_FEATURE_VERSION } from "@/shared/agent-feature-version";
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
  // Null = the device hasn't reported a featureVersion yet. Either it's
  // freshly enrolled and hasn't completed its first heartbeat, or it's
  // running a build that predates this field. Either way, prompting now
  // adds noise without clear action — once the device upgrades and sends
  // the field, the comparison kicks in naturally.
  if (featureVersion == null) return false;
  return featureVersion < MIN_AGENT_FEATURE_VERSION;
}

// React 19 cache() — multiple calls per render dedup. Not unstable_cache
// because we want a device's just-completed upgrade to reflect on the
// next render (no stale 30s window).
export const countOutdatedDevices = cache(async (userId: string): Promise<number> => {
  const devices = await prisma.device.findMany({
    where: { userId },
    select: { agentFeatureVersion: true },
  });
  return devices.filter((d) => isDeviceOutdated(d.agentFeatureVersion)).length;
});
