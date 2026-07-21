import { describe, expect, it } from "vitest";
import { enrichEventsWithGit, normalizeGitRemote } from "@/cli/git";

describe("normalizeGitRemote", () => {
  it("normalizes ssh form with git@host:owner/repo.git", () => {
    expect(normalizeGitRemote("git@github.com:tripplemay/aigcgateway.git")).toBe("github.com/tripplemay/aigcgateway");
  });

  it("normalizes https form with .git suffix", () => {
    expect(normalizeGitRemote("https://github.com/tripplemay/aigcgateway.git")).toBe("github.com/tripplemay/aigcgateway");
  });

  it("normalizes https form without .git suffix", () => {
    expect(normalizeGitRemote("https://github.com/tripplemay/aigcgateway")).toBe("github.com/tripplemay/aigcgateway");
  });

  it("normalizes ssh:// protocol form", () => {
    expect(normalizeGitRemote("ssh://git@github.com/tripplemay/aigcgateway.git")).toBe("github.com/tripplemay/aigcgateway");
  });

  it("collapses all four PRD §8.4 forms to the same repoKey", () => {
    const inputs = [
      "git@github.com:tripplemay/aigcgateway.git",
      "https://github.com/tripplemay/aigcgateway.git",
      "https://github.com/tripplemay/aigcgateway",
      "ssh://git@github.com/tripplemay/aigcgateway.git"
    ];
    const normalized = new Set(inputs.map(normalizeGitRemote));
    expect(normalized.size).toBe(1);
    expect([...normalized][0]).toBe("github.com/tripplemay/aigcgateway");
  });

  it("lowercases mixed-case host and owner", () => {
    expect(normalizeGitRemote("https://GitHub.com/TrippleMay/AigcGateway.git")).toBe("github.com/tripplemay/aigcgateway");
  });

  it("handles http (non-tls) protocol", () => {
    expect(normalizeGitRemote("http://github.com/tripplemay/aigcgateway.git")).toBe("github.com/tripplemay/aigcgateway");
  });

  it("handles git:// protocol", () => {
    expect(normalizeGitRemote("git://github.com/tripplemay/aigcgateway.git")).toBe("github.com/tripplemay/aigcgateway");
  });

  it("normalizes self-hosted gitlab ssh form", () => {
    expect(normalizeGitRemote("git@gitlab.example.com:team/repo.git")).toBe("gitlab.example.com/team/repo");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeGitRemote("  https://github.com/foo/bar.git  ")).toBe("github.com/foo/bar");
  });

  it("returns null for null input", () => {
    expect(normalizeGitRemote(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizeGitRemote("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(normalizeGitRemote("   ")).toBeNull();
  });
});

describe("enrichEventsWithGit path normalization", () => {
  // These paths don't exist, so the git probe fails and we exercise the
  // no-git fallback — which is exactly where an unnormalized Windows path
  // would leak through to the server's userId_workspacePath unique index.
  const event = (workspacePath: string) =>
    ({ source: "claude", sourceEventId: "x", model: "m", occurredAt: "2026-01-01T00:00:00.000Z", workspacePath }) as never;

  it("collapses git-style and native-style Windows paths to one spelling", () => {
    const [a] = enrichEventsWithGit([event("C:/Users/me/proj")]);
    const [b] = enrichEventsWithGit([event("c:\\Users\\me\\proj")]);
    expect(a.workspacePath).toBe("C:\\Users\\me\\proj");
    expect(b.workspacePath).toBe("C:\\Users\\me\\proj");
  });

  it("mirrors the normalized path into localWorkspacePath", () => {
    const [enriched] = enrichEventsWithGit([event("C:/Users/me/proj")]);
    expect(enriched.localWorkspacePath).toBe("C:\\Users\\me\\proj");
  });

  it("leaves POSIX workspace paths byte-identical", () => {
    const [enriched] = enrichEventsWithGit([event("/Users/me/proj")]);
    expect(enriched.workspacePath).toBe("/Users/me/proj");
  });

  it("does not rewrite sourceEventId", () => {
    // sourceEventId embeds absolute paths and is the ingest dedup key —
    // touching it would re-ingest every device's entire history.
    const [enriched] = enrichEventsWithGit([event("C:/Users/me/proj")]);
    expect(enriched.sourceEventId).toBe("x");
  });
});
