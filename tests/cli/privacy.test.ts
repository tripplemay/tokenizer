import { describe, expect, it } from "vitest";
import { collectionScopeFingerprint, describePrivacyBacklog, effectivePrivacy, filterUsageEvents } from "@/cli/privacy";
import type { TokenizerConfig } from "@/cli/config";
import type { UsageEventInput } from "@/shared/usage";

const base = { serverUrl: "https://example.test", projectRoots: [], sources: {
  claude: false, codex: false, opencode: false, aider: false, kimicode: false
} } satisfies TokenizerConfig;

const event = (workspacePath: string | null): UsageEventInput => ({
  source: "claude-code", sourceEventId: `evt-${workspacePath}`, workspacePath,
  occurredAt: "2026-01-01T00:00:00.000Z"
});

describe("privacy controls", () => {
  it("does not treat projectRoots as an upload allowlist", () => {
    const config = { ...base, projectRoots: ["/work/allowed"] };
    expect(filterUsageEvents([event("/work/outside")], effectivePrivacy(config))).toHaveLength(1);
  });

  it("applies explicit include and exclude paths with directory boundaries", () => {
    const config = { ...base, privacy: { mode: "sync" as const, includePaths: ["/work"], excludePaths: ["/work/private"] } };
    const filtered = filterUsageEvents([
      event("/work/public/app"), event("/work/private/app"), event("/workspace/sibling"), event(null)
    ], effectivePrivacy(config));
    expect(filtered.map((row) => row.workspacePath)).toEqual(["/work/public/app"]);
  });

  it("fails closed on malformed privacy settings", () => {
    expect(() => effectivePrivacy({ ...base, privacy: { mode: "unknown", includePaths: [], excludePaths: [] } } as unknown as TokenizerConfig)).toThrow("Invalid privacy mode");
    expect(() => effectivePrivacy({ ...base, privacy: { mode: "sync", includePaths: ["relative"], excludePaths: [] } })).toThrow("absolute");
  });

  it("labels collection rules independently of upload mode or rule ordering", () => {
    const original = { mode: "local-only" as const, includePaths: ["/work/a", "/work/b"], excludePaths: [] };
    expect(collectionScopeFingerprint(original)).toBe(collectionScopeFingerprint({ ...original, mode: "sync", includePaths: ["/work/b", "/work/a", "/work/a"] }));
    expect(collectionScopeFingerprint(original)).not.toBe(collectionScopeFingerprint({ ...original, excludePaths: ["/work/private"] }));
    expect(JSON.stringify(original)).not.toContain("scope-v1:");
  });

  it("discloses admitted backlog and next-cycle automatic upload rather than promising an immediate upload", () => {
    expect(describePrivacyBacklog("sync", 7)).toContain("7 previously admitted events; automatic upload on the next Agent/run/sync cycle");
    expect(describePrivacyBacklog("local-only", 7)).toContain("Switching to sync automatically uploads them on the next Agent/run/sync cycle");
    expect(describePrivacyBacklog("paused", 7)).toContain("retained locally while paused");
  });
});
