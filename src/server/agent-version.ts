import { cache } from "react";
import { MIN_AGENT_FEATURE_VERSION } from "@/shared/agent-feature-version";
import { prisma } from "./db";

// The curl install URL — kept in code so it's easy to point staging at
// a different host during testing. Production is token.vpanel.cc.
export const INSTALL_COMMAND =
  "curl -fsSL https://token.vpanel.cc/install.sh | bash";

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
