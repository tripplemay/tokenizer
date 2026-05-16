import { describe, expect, it } from "vitest";
import { normalizeGitRemote } from "@/cli/git";

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
