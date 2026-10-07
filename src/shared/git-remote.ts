export type ParsedGitRemote = {
  repoKey: string;
  safeRemote: string;
};

const DEFAULT_PORT: Record<string, string> = {
  "http:": "80",
  "https:": "443",
  "ssh:": "22",
  "git:": "9418"
};

export function parseGitRemote(remote: string | null | undefined): ParsedGitRemote | null {
  if (!remote) return null;
  const value = remote.trim();
  if (!value || /[\u0000-\u001F\u007F]/.test(value)) return null;

  let url: URL;
  try {
    if (value.includes("://")) {
      url = new URL(value);
      if (!(url.protocol in DEFAULT_PORT)) return null;
    } else if (!value.includes("@") && /^(?:\[[^\]]+\]|[^/:?#]+):\d{1,5}\//.test(value)) {
      url = new URL(`https://${value}`);
    } else {
      const scp = /^(?:([^@/:?#]+)@)?(\[[^\]]+\]|[^@/:/?#]+):([^?#]+)(?:[?#].*)?$/.exec(value);
      if (scp) {
        if (scp[3].split("/")[0].includes("@")) return null;
        url = new URL(`ssh://${scp[2]}/${scp[3]}`);
      } else {
        if (value.startsWith("/") || value.includes("\\") || !value.includes("/")) return null;
        url = new URL(`https://${value}`);
      }
    }
  } catch {
    return null;
  }

  if (!url.hostname || url.pathname === "/") return null;
  const path = url.pathname.slice(1).replace(/\/+$/, "");
  const identityPath = path.replace(/\.git$/i, "");
  if (!identityPath || identityPath === "." || identityPath === "..") return null;

  const port = url.port && url.port !== DEFAULT_PORT[url.protocol] ? `:${url.port}` : "";
  const authority = `${url.hostname.toLowerCase()}${port}`;
  return {
    repoKey: `${authority}/${identityPath}`,
    safeRemote: `${url.protocol}//${authority}/${path}`
  };
}

export function sanitizeUsageEventGit(event: UsageEventInput): UsageEventInput {
  const remote = parseGitRemote(event.gitRemote);
  const key = parseGitRemote(event.repoKey);
  return {
    ...event,
    repoKey: remote?.repoKey ?? key?.repoKey ?? null,
    gitRemote: remote?.safeRemote ?? null
  };
}
import type { UsageEventInput } from "./usage";
