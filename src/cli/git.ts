import { execFileSync } from "node:child_process";
import { UsageEventInput } from "@/shared/usage";

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
  if (cache.has(workspacePath)) return cache.get(workspacePath) ?? null;

  const root = git(["rev-parse", "--show-toplevel"], workspacePath);
  if (!root) {
    cache.set(workspacePath, null);
    return null;
  }

  const remote = git(["remote", "get-url", "origin"], root);
  const info = {
    localWorkspacePath: root,
    repoKey: normalizeGitRemote(remote),
    gitRemote: remote,
    gitBranch: git(["branch", "--show-current"], root),
    gitCommit: git(["rev-parse", "HEAD"], root)
  };
  cache.set(workspacePath, info);
  return info;
}

export function enrichEventsWithGit(events: UsageEventInput[]): UsageEventInput[] {
  return events.map((event) => {
    const info = getGitInfo(event.workspacePath);
    if (!info) return { ...event, localWorkspacePath: event.localWorkspacePath ?? event.workspacePath ?? null };
    return { ...event, ...info };
  });
}
