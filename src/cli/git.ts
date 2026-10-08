import { execFileSync } from "node:child_process";
import { parseGitRemote } from "@/shared/git-remote";
import { UsageEventInput } from "@/shared/usage";
import { normalizeWorkspacePath, pathCacheKey } from "@/shared/path";
import { BoundedSubprocessLaunchError, BoundedSubprocessSupervisionError, runBoundedSubprocess, SUBPROCESS_TOTAL_ALLOWANCE_MS } from "./bounded-subprocess";

type GitInfo = {
  localWorkspacePath: string;
  repoKey: string | null;
  gitRemote: string | null;
  gitBranch: string | null;
  gitCommit: string | null;
};

const cache = new Map<string, GitInfo | null>();
// Leave time for child termination and replay refusal propagation inside the
// operation-wide deadline rather than using the full budget in execFileSync.
const DEADLINE_TERMINATION_MARGIN_MS = SUBPROCESS_TOTAL_ALLOWANCE_MS;

export type GitEnrichmentOptions = { deadlineMs?: number };

function remainingTimeout(options: GitEnrichmentOptions): number | undefined {
  if (options.deadlineMs === undefined) return undefined;
  const remaining = options.deadlineMs - Date.now();
  if (remaining <= DEADLINE_TERMINATION_MARGIN_MS) throw new Error("Replay Git enrichment deadline exceeded");
  return Math.max(1, Math.floor(remaining - DEADLINE_TERMINATION_MARGIN_MS));
}

function git(args: string[], cwd: string, options: GitEnrichmentOptions): string | null {
  if (options.deadlineMs !== undefined) {
    const timeoutMs = remainingTimeout(options)!;
    try {
      const result = runBoundedSubprocess("git", args, { cwd, timeoutMs, maxOutputBytes: 64 * 1024 });
      if (result.signal !== null) throw new BoundedSubprocessSupervisionError("Replay Git process terminated unexpectedly");
      if (Date.now() >= options.deadlineMs) throw new Error("Replay Git enrichment deadline exceeded");
      return result.status === 0 ? result.stdout.trim() || null : null;
    } catch (error) {
      // A missing executable remains compatible with ordinary non-Git source
      // files. Timeout/output/supervision errors must never cache partial data.
      if (error instanceof BoundedSubprocessLaunchError && error.code === "ENOENT") return null;
      throw error;
    }
  }
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim() || null;
  } catch {
    return null;
  }
}

export function normalizeGitRemote(remote: string | null): string | null {
  return parseGitRemote(remote)?.repoKey ?? null;
}

function getGitInfo(workspacePath?: string | null, options: GitEnrichmentOptions = {}): GitInfo | null {
  remainingTimeout(options);
  if (!workspacePath) return null;
  const cacheKey = pathCacheKey(workspacePath);
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;

  const root = git(["rev-parse", "--show-toplevel"], workspacePath, options);
  if (!root) {
    cache.set(cacheKey, null);
    return null;
  }

  const remote = git(["remote", "get-url", "origin"], root, options);
  const parsedRemote = parseGitRemote(remote);
  const info = {
    // git prints "C:/Users/me/proj" even on Windows, while the agent logs
    // record "C:\Users\me\proj". Unnormalized, the same directory keys as two
    // different projects server-side.
    localWorkspacePath: normalizeWorkspacePath(root),
    repoKey: parsedRemote?.repoKey ?? null,
    gitRemote: parsedRemote?.safeRemote ?? null,
    gitBranch: git(["branch", "--show-current"], root, options),
    gitCommit: git(["rev-parse", "HEAD"], root, options)
  };
  cache.set(cacheKey, info);
  return info;
}

export function enrichEventsWithGit(events: UsageEventInput[], options: GitEnrichmentOptions = {}): UsageEventInput[] {
  return events.map((event) => {
    const info = getGitInfo(event.workspacePath, options);
    // Normalized on the way out so both the git-backed and the no-git path
    // agree on one spelling. Identity for POSIX paths, so existing installs
    // keep hashing to the same userId_workspacePath row.
    const workspacePath = event.workspacePath ? normalizeWorkspacePath(event.workspacePath) : event.workspacePath;
    if (!info) {
      return { ...event, workspacePath, localWorkspacePath: event.localWorkspacePath ?? workspacePath ?? null };
    }
    return { ...event, ...info, workspacePath };
  });
}
