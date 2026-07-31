import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import agentReleasesManifest from "../../src/shared/agent-releases.json";
import { AGENT_FEATURE_VERSION } from "@/shared/agent-feature-version";
import {
  AGENT_RELEASES,
  AGENT_RELEASE_VERSIONS,
  CURRENT_AGENT_RELEASE_VERSION,
  LATEST_AGENT_RELEASE,
  agentReleaseStanding,
  compareAgentReleaseVersion,
  normalizeAgentReleaseVersion,
  parseAgentReleaseVersion
} from "@/shared/agent-release-version";

const SOURCE = fileURLToPath(new URL("../../src/shared/agent-release-version.ts", import.meta.url));

describe("Agent release manifest contract", () => {
  it("derives the running and latest Agent release from one checked-in manifest", () => {
    const latest = agentReleasesManifest.releases.at(-1);
    expect(AGENT_RELEASES).toEqual(agentReleasesManifest.releases);
    expect(AGENT_RELEASE_VERSIONS).toEqual(agentReleasesManifest.releases.map((release) => release.version));
    expect(LATEST_AGENT_RELEASE).toEqual(latest);
    expect(CURRENT_AGENT_RELEASE_VERSION).toBe(latest?.version);
    expect(LATEST_AGENT_RELEASE).toMatchObject({
      version: "1.1.0",
      agent_feature_version: AGENT_FEATURE_VERSION
    });
  });

  it("keeps stable, strictly increasing release entries with localized highlights", () => {
    expect(agentReleasesManifest.schema_version).toBe(1);
    expect(agentReleasesManifest.releases.length).toBeGreaterThan(0);
    for (const [index, release] of agentReleasesManifest.releases.entries()) {
      expect(normalizeAgentReleaseVersion(release.version)).toBe(release.version);
      expect(release.released_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isSafeInteger(release.agent_feature_version)).toBe(true);
      expect(release.agent_feature_version).toBeGreaterThan(0);
      expect(release.highlights["zh-CN"].length).toBeGreaterThan(0);
      expect(release.highlights.en.length).toBeGreaterThan(0);
      expect(release.highlights["zh-CN"].every(Boolean)).toBe(true);
      expect(release.highlights.en.every(Boolean)).toBe(true);
      if (index > 0) {
        expect(compareAgentReleaseVersion(agentReleasesManifest.releases[index - 1].version, release.version)).toBeLessThan(0);
      }
    }
  });

  it("does not keep a second hand-written current release constant", () => {
    const source = readFileSync(SOURCE, "utf8");
    expect(source).toContain("agent-releases.json");
    expect(source).toMatch(/CURRENT_AGENT_RELEASE_VERSION\s*=\s*LATEST_AGENT_RELEASE\.version/);
  });
});

describe("Agent release parsing", () => {
  it("accepts stable three-part SemVer and normalizes a display v prefix", () => {
    expect(parseAgentReleaseVersion("1.0.0")).toEqual([1, 0, 0]);
    expect(parseAgentReleaseVersion("v1.10.3")).toEqual([1, 10, 3]);
    expect(normalizeAgentReleaseVersion("v1.10.3")).toBe("1.10.3");
  });

  it("rejects malformed, pre-release, leading-zero, and unsafe versions", () => {
    for (const value of ["", "unknown", "1.0", "1.0.0.1", "1.0.0-beta", "1.0.0+build", "01.0.0", "1.00.0", "1.0.00", "9007199254740992.0.0", null, undefined]) {
      expect(parseAgentReleaseVersion(value)).toBeNull();
      expect(normalizeAgentReleaseVersion(value)).toBeNull();
    }
  });
});

describe("Agent release standing", () => {
  it("keeps latest, behind, ahead, and unknown distinct", () => {
    expect(agentReleaseStanding(CURRENT_AGENT_RELEASE_VERSION)).toEqual({
      kind: "latest",
      reported: CURRENT_AGENT_RELEASE_VERSION,
      behind: null,
      latest: CURRENT_AGENT_RELEASE_VERSION
    });
    expect(agentReleaseStanding("0.9.9")).toEqual({
      kind: "behind",
      reported: "0.9.9",
      behind: null,
      latest: CURRENT_AGENT_RELEASE_VERSION
    });
    expect(agentReleaseStanding("9.0.0")).toEqual({
      kind: "ahead",
      reported: "9.0.0",
      behind: null,
      latest: CURRENT_AGENT_RELEASE_VERSION
    });
    expect(agentReleaseStanding(null)).toEqual({
      kind: "unknown",
      reported: null,
      behind: null,
      latest: CURRENT_AGENT_RELEASE_VERSION
    });
  });
});
