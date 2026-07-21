import { execFileSync } from "node:child_process";
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

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

export function normalizeGitRemote(remote: string | null): string | null {
  if (!remote) return null;
  let value = remote.trim();
  value = value.replace(/^ssh:\/\/git@/i, "");
  value = value.replace(/^git@([^:]+):/i, "$1/");
  value = value.replace(/^https?:\/\//i, "");
  value = value.replace(/^git:\/\//i, "");
  value = value.replace(/\.git$/i, "");
  return value.toLowerCase() || null;
}

function getGitInfo(workspacePath?: string | null): GitInfo | null {
  if (!workspacePath) return null;
  const cacheKey = pathCacheKey(workspacePath);
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;

  const root = git(["rev-parse", "--show-toplevel"], workspacePath);
  if (!root) {
    cache.set(cacheKey, null);
    return null;
  }

  const remote = git(["remote", "get-url", "origin"], root);
  const info = {
    // git prints "C:/Users/me/proj" even on Windows, while the agent logs
    // record "C:\Users\me\proj". Unnormalized, the same directory keys as two
    // different projects server-side.
    localWorkspacePath: normalizeWorkspacePath(root),
    repoKey: normalizeGitRemote(remote),
    gitRemote: remote,
    gitBranch: git(["branch", "--show-current"], root),
    gitCommit: git(["rev-parse", "HEAD"], root)
  };
  cache.set(cacheKey, info);
  return info;
}

export function enrichEventsWithGit(events: UsageEventInput[]): UsageEventInput[] {
  return events.map((event) => {
    const info = getGitInfo(event.workspacePath);
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
