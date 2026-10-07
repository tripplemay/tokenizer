import { isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { isPathUnder, isWindowsPath, pathCacheKey } from "@/shared/path";
import type { UsageEventInput } from "@/shared/usage";
import type { TokenizerConfig } from "./config";

export type PrivacyMode = "sync" | "local-only" | "paused";

export type PrivacyConfig = {
  mode: PrivacyMode;
  includePaths: string[];
  excludePaths: string[];
};

export function effectivePrivacy(config: TokenizerConfig): PrivacyConfig {
  const privacy = config.privacy;
  const mode = privacy?.mode ?? "sync";
  if (mode !== "sync" && mode !== "local-only" && mode !== "paused") {
    throw new Error(`Invalid privacy mode: ${String(mode)}`);
  }
  const includePaths = privacy?.includePaths ?? [];
  const excludePaths = privacy?.excludePaths ?? [];
  if (![includePaths, excludePaths].every((paths) => Array.isArray(paths) && paths.every((path) =>
    typeof path === "string" && path.length > 0 && (isAbsolute(path) || isWindowsPath(path))
  ))) {
    throw new Error("Privacy include/exclude paths must be absolute");
  }
  return { mode, includePaths, excludePaths };
}

export function mayCollectEvent(event: UsageEventInput, privacy: PrivacyConfig): boolean {
  const paths = [event.workspacePath, event.localWorkspacePath].filter((path): path is string => typeof path === "string" && path.length > 0);
  if (privacy.excludePaths.some((root) => paths.some((path) => isPathUnder(path, root)))) return false;
  return privacy.includePaths.length === 0 || privacy.includePaths.some((root) => paths.some((path) => isPathUnder(path, root)));
}

export function filterUsageEvents(events: UsageEventInput[], privacy: PrivacyConfig): UsageEventInput[] {
  return events.filter((event) => mayCollectEvent(event, privacy));
}

// A local collection-rule label only: never a cursor reset, event ID, or wire field.
export function collectionScopeFingerprint(privacy: PrivacyConfig): string {
  const canonical = (paths: string[]) => [...new Set(paths.map((path) => pathCacheKey(path)))].sort();
  return `scope-v1:${createHash("sha256").update(JSON.stringify({
    includePaths: canonical(privacy.includePaths),
    excludePaths: canonical(privacy.excludePaths)
  })).digest("hex")}`;
}

export function describePrivacyBacklog(mode: PrivacyMode, count: number): string {
  const prefix = `Backlog: ${count} previously admitted events`;
  if (mode === "sync") return `${prefix}; automatic upload on the next Agent/run/sync cycle.`;
  return `${prefix}; retained locally while ${mode}. Switching to sync automatically uploads them on the next Agent/run/sync cycle.`;
}
