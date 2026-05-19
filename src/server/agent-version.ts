import { cache } from "react";
import { prisma } from "./db";

// Bump when a server-side feature relies on client-side code changes
// (e.g., new parser fields, new agent loop responsibilities). Devices
// reporting any other SHA will be prompted to upgrade.
//
// History (newest first):
//   8101f94 — 2026-05-19: Codex quota poll + Claude JSONL enrichment
//   c4bc2f2 — 2026-05-19: timezone capture
export const MIN_AGENT_SHA = "8101f94";

// The curl install URL — kept in code so it's easy to point staging at
// a different host during testing. Production is token.vpanel.cc.
export const INSTALL_COMMAND =
  "curl -fsSL https://token.vpanel.cc/install.sh | bash";

export function isDeviceOutdated(agentVersion: string | null | undefined): boolean {
  // Devices that have never reported a version (agentVersion === null)
  // are ignored — they're either freshly enrolled and haven't completed
  // their first heartbeat yet, or running such an old agent it predates
  // the agentVersion field. Either way, prompting them now adds noise
  // without clear action.
  if (!agentVersion) return false;
  return agentVersion !== MIN_AGENT_SHA;
}

// React 19 cache() — multiple calls per render dedup. Not unstable_cache
// because we want a device's just-completed upgrade to reflect on the
// next render (no stale 30s window).
export const countOutdatedDevices = cache(async (userId: string): Promise<number> => {
  const devices = await prisma.device.findMany({
    where: { userId },
    select: { agentVersion: true },
  });
  return devices.filter((d) => isDeviceOutdated(d.agentVersion)).length;
});
