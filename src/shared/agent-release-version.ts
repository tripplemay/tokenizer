import agentReleasesManifest from "./agent-releases.json";

// Agent releases are intentionally separate from both capability levels and
// Harness framework releases. A release is what an operator can upgrade to;
// a capability level is only a compatibility threshold; the framework has its
// own lifecycle and release ledger.
export type AgentRelease = (typeof agentReleasesManifest.releases)[number];
export type AgentReleaseStandingKind = "latest" | "behind" | "ahead" | "unknown";

export type AgentReleaseStanding = {
  kind: AgentReleaseStandingKind;
  /** Canonical release reported by the device, if it was a valid stable SemVer. */
  reported: string | null;
  /** Number of manifest releases between the reported and latest release. */
  behind: number | null;
  latest: string;
};

export const AGENT_RELEASES = Object.freeze([...agentReleasesManifest.releases]);
export const AGENT_RELEASE_VERSIONS = Object.freeze(AGENT_RELEASES.map((release) => release.version));

const latestRelease = AGENT_RELEASES[AGENT_RELEASES.length - 1];
if (!latestRelease) throw new Error("agent release manifest must contain at least one release");

export const LATEST_AGENT_RELEASE = latestRelease;

// This module is loaded once when the CLI process starts. Consequently an old
// daemon that remains alive while its checkout is updated still reports the
// release it actually started with, rather than the release now on disk.
export const CURRENT_AGENT_RELEASE_VERSION = LATEST_AGENT_RELEASE.version;

const STABLE_SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MAX_RELEASE_VERSION_LENGTH = 64;

/** Parses stable three-part SemVer and accepts an optional display-only v prefix. */
export function parseAgentReleaseVersion(value: unknown): number[] | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_RELEASE_VERSION_LENGTH) return null;
  const match = STABLE_SEMVER.exec(value.trim());
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

/** Returns the canonical storage form, without a v prefix, or null when unsafe. */
export function normalizeAgentReleaseVersion(value: unknown): string | null {
  const parts = parseAgentReleaseVersion(value);
  return parts ? parts.join(".") : null;
}

/** Semantic comparison; invalid values are deliberately not guessed. */
export function compareAgentReleaseVersion(left: unknown, right: unknown): number | null {
  const a = parseAgentReleaseVersion(left);
  const b = parseAgentReleaseVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

/**
 * Classifies a device release against the server's release ledger.
 *
 * Unknown means that no trustworthy release was reported. It must never be
 * conflated with latest: it gets a weak device-level prompt rather than a
 * false claim about what feature the client lacks.
 */
export function agentReleaseStanding(value: unknown): AgentReleaseStanding {
  const latest = LATEST_AGENT_RELEASE.version;
  const reported = normalizeAgentReleaseVersion(value);
  if (!reported) return { kind: "unknown", reported: null, behind: null, latest };

  const comparison = compareAgentReleaseVersion(reported, latest);
  if (comparison === null) return { kind: "unknown", reported: null, behind: null, latest };
  if (comparison > 0) return { kind: "ahead", reported, behind: null, latest };
  if (comparison === 0) return { kind: "latest", reported, behind: null, latest };

  const index = AGENT_RELEASE_VERSIONS.indexOf(reported);
  return {
    kind: "behind",
    reported,
    behind: index < 0 ? null : AGENT_RELEASE_VERSIONS.length - 1 - index,
    latest
  };
}

export function latestAgentReleaseHighlights(locale: string): readonly string[] {
  return locale === "zh-CN"
    ? LATEST_AGENT_RELEASE.highlights["zh-CN"]
    : LATEST_AGENT_RELEASE.highlights.en;
}
