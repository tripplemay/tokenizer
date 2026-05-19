import { cache } from "react";
import { prisma } from "./db";

// SHAs of agent releases that are considered up-to-date. Add a new SHA
// here when shipping a commit that should not trigger the upgrade banner.
//
// Why a set (not a single MIN_AGENT_SHA): the server can't order git SHAs
// without the repo, so "agentVersion >= MIN" comparisons aren't possible.
// Listing every known-good SHA explicitly lets us land follow-up commits
// without falsely marking already-upgraded devices as outdated.
//
// History (newest first):
//   380b1e594025 — 2026-05-19: upgrade-reminder SHA-length + slot-pattern follow-up
//   8101f94f6111 — 2026-05-19: Codex quota poll + Claude JSONL enrichment
//   c4bc2f251cf9 — 2026-05-19: timezone capture
export const ACCEPTABLE_AGENT_SHAS: ReadonlySet<string> = new Set([
  "8101f94f6111",
  "380b1e594025",
]);

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
  return !ACCEPTABLE_AGENT_SHAS.has(agentVersion);
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
