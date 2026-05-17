// Build a browser-clickable URL from a normalised repoKey such as
// "github.com/tripplemay/kolmatrix". Returns null only for empty input so the
// caller can decide between "render an icon-link" vs "render a folder icon".

export type RepoHost = "github" | "gitlab" | "bitbucket" | "other";

export type RepoLink = {
  host: RepoHost;
  url: string;
  // Trimmed display label, e.g. "tripplemay/kolmatrix"
  label: string;
};

const KNOWN_HOSTS: Array<{ prefix: string; host: RepoHost }> = [
  { prefix: "github.com/", host: "github" },
  { prefix: "gitlab.com/", host: "gitlab" },
  { prefix: "bitbucket.org/", host: "bitbucket" }
];

export function describeRepoLink(repoKey: string | null | undefined): RepoLink | null {
  if (!repoKey) return null;
  const trimmed = repoKey.trim();
  if (!trimmed) return null;
  const url = `https://${trimmed}`;
  for (const candidate of KNOWN_HOSTS) {
    if (trimmed.startsWith(candidate.prefix)) {
      return { host: candidate.host, url, label: trimmed.slice(candidate.prefix.length) };
    }
  }
  return { host: "other", url, label: trimmed };
}
