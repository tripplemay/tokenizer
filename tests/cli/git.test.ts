import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

  it("lowercases the host but preserves case-sensitive repository paths", () => {
    expect(normalizeGitRemote("https://GitHub.com/TrippleMay/AigcGateway.git")).toBe("github.com/TrippleMay/AigcGateway");
    expect(normalizeGitRemote("https://git.example/Team/Repo.git")).not.toBe(
      normalizeGitRemote("https://git.example/team/repo.git")
    );
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

  it("removes userinfo, query, and fragment without changing repository identity", () => {
    const remotes = [
      "https://user:FAKE_TOKEN_A@GitHub.com/Team/Repo.git?token=FAKE_QUERY#FAKE_FRAGMENT",
      "ssh://deploy:FAKE_TOKEN_B@github.com/Team/Repo.git?token=FAKE_QUERY",
      "deploy@github.com:Team/Repo.git#FAKE_FRAGMENT",
      "github.com/Team/Repo"
    ];
    expect(remotes.map(normalizeGitRemote)).toEqual(Array(4).fill("github.com/Team/Repo"));
  });

  it("normalizes default ports and retains non-default ports", () => {
    expect(normalizeGitRemote("https://user:pass@GIT.example:443/Team/Repo.git")).toBe("git.example/Team/Repo");
    expect(normalizeGitRemote("ssh://git@GIT.example:22/Team/Repo.git")).toBe("git.example/Team/Repo");
    expect(normalizeGitRemote("https://git.example:8443/Team/Repo.git")).toBe("git.example:8443/Team/Repo");
    expect(normalizeGitRemote("ssh://git@git.example:2222/Team/Repo.git")).toBe("git.example:2222/Team/Repo");
    expect(normalizeGitRemote("git.example:8443/Team/Repo")).toBe("git.example:8443/Team/Repo");
  });

  it("fails closed for local, unsupported, and malformed remotes", () => {
    expect(normalizeGitRemote("file:///private/repo.git")).toBeNull();
    expect(normalizeGitRemote("/private/repo.git")).toBeNull();
    expect(normalizeGitRemote("ftp://user:FAKE_TOKEN@git.example/repo.git")).toBeNull();
    expect(normalizeGitRemote("https://user:FAKE_TOKEN@git.example")).toBeNull();
    expect(normalizeGitRemote("git@git.example:FAKE_TOKEN@git.example/repo.git")).toBeNull();
  });
});

describe("enrichEventsWithGit credential boundary", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("keeps synthetic remote credentials out of the event payload", () => {
    const root = mkdtempSync(join(tmpdir(), "tokenizer-git-privacy-"));
    roots.push(root);
    execFileSync("git", ["init", "--quiet", root]);
    execFileSync("git", ["-C", root, "remote", "add", "origin", "https://reader:FAKE_TOKEN@git.example/Team/Repo.git?key=FAKE_QUERY#FAKE_FRAGMENT"]);

    const [enriched] = enrichEventsWithGit([{
      source: "claude-code",
      sourceEventId: "evt-1",
      occurredAt: "2026-01-01T00:00:00.000Z",
      workspacePath: root
    }]);

    expect(enriched.repoKey).toBe("git.example/Team/Repo");
    expect(enriched.gitRemote).toBe("https://git.example/Team/Repo.git");
    expect(JSON.stringify(enriched)).not.toMatch(/FAKE_TOKEN|FAKE_QUERY|FAKE_FRAGMENT/);
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
