import { execFileSync } from "node:child_process";
import { parseGitRemote } from "@/shared/git-remote";
import { UsageEventInput } from "@/shared/usage";
import { normalizeWorkspacePath, pathCacheKey } from "@/shared/path";

type GitInfo = {
  localWorkspacePath: string;
  repoKey: string | null;
  gitRemote: string | null;
  gitBranch: string | null;
  gitCommit: string | null;
};

const cache = new Map<string, GitInfo | null>();
const DEADLINE_TERMINATION_MARGIN_MS = 1_000;

export type GitEnrichmentOptions = { deadlineMs?: number };

function remainingTimeout(options: GitEnrichmentOptions): number | undefined {
  if (options.deadlineMs === undefined) return undefined;
  const remaining = options.deadlineMs - Date.now();
  if (remaining <= DEADLINE_TERMINATION_MARGIN_MS) throw new Error("Replay Git enrichment deadline exceeded");
  return Math.max(1, Math.floor(remaining - DEADLINE_TERMINATION_MARGIN_MS));
}

function git(args: string[], cwd: string, options: GitEnrichmentOptions): string | null {
  try {
    const timeout = remainingTimeout(options);
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      ...(timeout === undefined ? {} : { timeout })
    }).trim() || null;
  } catch (error) {
    const processError = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null };
    if (options.deadlineMs !== undefined &&
        (processError.code === "ETIMEDOUT" || processError.killed === true || typeof processError.signal === "string" ||
         Date.now() >= options.deadlineMs)) {
      throw new Error("Replay Git enrichment deadline exceeded");
    }
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
