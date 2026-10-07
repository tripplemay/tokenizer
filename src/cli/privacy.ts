import { isAbsolute } from "node:path";
import { isPathUnder, isWindowsPath } from "@/shared/path";
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
