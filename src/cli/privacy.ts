import { isAbsolute, posix, win32 } from "node:path";
import { lstatSync, realpathSync } from "node:fs";
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

function physicalScopePath(value: string): string | null {
  const windows = isWindowsPath(value) || (process.platform === "win32" && value.startsWith("//"));
  const paths = windows ? win32 : posix;
  if (!paths.isAbsolute(value) || value.split(windows ? /[\\/]/ : /\//).some((part) => part === "." || part === "..")) return null;
  const normalized = paths.normalize(value);
  // Foreign-platform legacy paths cannot be resolved on this host. Compare
  // their native lexical form, but never rewrite event/cursor/wire identities.
  if (windows !== (process.platform === "win32")) return normalized;
  let current = normalized;
  const missing: string[] = [];
  for (;;) {
    try {
      const resolved = realpathSync.native(current);
      // Windows reports ENOENT for a child beneath an existing regular file.
      if (missing.length > 0 && !lstatSync(resolved).isDirectory()) return null;
      return paths.join(resolved, ...missing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
      try {
        // A broken link is not an ordinary nonexistent descendant.
        lstatSync(current);
        return null;
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT") return null;
      }
      const parent = paths.dirname(current);
      if (parent === current) return null;
      missing.unshift(paths.basename(current));
      current = parent;
    }
  }
}

export function mayCollectEvent(event: UsageEventInput, privacy: PrivacyConfig): boolean {
  if (privacy.includePaths.length === 0 && privacy.excludePaths.length === 0) return true;
  const paths = [event.workspacePath, event.localWorkspacePath]
    .filter((path): path is string => typeof path === "string" && path.length > 0).map(physicalScopePath);
  const includes = privacy.includePaths.map(physicalScopePath);
  const excludes = privacy.excludePaths.map(physicalScopePath);
  if ([...paths, ...includes, ...excludes].some((path) => path === null)) return false;
  const physical = paths as string[];
  if ((excludes as string[]).some((root) => physical.some((path) => isPathUnder(path, root)))) return false;
  return includes.length === 0 || (physical.length > 0 && physical.every((path) =>
    (includes as string[]).some((root) => isPathUnder(path, root))));
}

export function filterUsageEvents(events: UsageEventInput[], privacy: PrivacyConfig): UsageEventInput[] {
  return events.filter((event) => mayCollectEvent(event, privacy));
}

// Replay confirmation only; never a queue/cursor identity or transmitted field.
export function collectionAdmissionFingerprint(events: UsageEventInput[], privacy: PrivacyConfig): string {
  return createHash("sha256").update(JSON.stringify({
    schema: "physical-admission-v1",
    includes: privacy.includePaths.map(physicalScopePath),
    excludes: privacy.excludePaths.map(physicalScopePath),
    events: events.map((event) => ({
      source: event.source,
      sourceEventId: event.sourceEventId,
      workspace: event.workspacePath ? physicalScopePath(event.workspacePath) : null,
      localWorkspace: event.localWorkspacePath ? physicalScopePath(event.localWorkspacePath) : null
    }))
  })).digest("hex");
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
