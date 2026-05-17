import { describe, expect, it } from "vitest";
import { describeRepoLink } from "@/shared/repo-link";

describe("describeRepoLink", () => {
  it("returns null for empty input", () => {
    expect(describeRepoLink(null)).toBe(null);
    expect(describeRepoLink(undefined)).toBe(null);
    expect(describeRepoLink("")).toBe(null);
    expect(describeRepoLink("   ")).toBe(null);
  });

  it("recognises github.com hosts", () => {
    const link = describeRepoLink("github.com/tripplemay/kolmatrix");
    expect(link).toEqual({
      host: "github",
      url: "https://github.com/tripplemay/kolmatrix",
      label: "tripplemay/kolmatrix"
    });
  });

  it("recognises gitlab.com and bitbucket.org", () => {
    expect(describeRepoLink("gitlab.com/group/proj")?.host).toBe("gitlab");
    expect(describeRepoLink("bitbucket.org/team/proj")?.host).toBe("bitbucket");
  });

  it("falls back to 'other' for self-hosted git remotes", () => {
    const link = describeRepoLink("git.internal.example.com/team/proj");
    expect(link?.host).toBe("other");
    expect(link?.url).toBe("https://git.internal.example.com/team/proj");
    expect(link?.label).toBe("git.internal.example.com/team/proj");
  });

  it("trims surrounding whitespace before classifying", () => {
    expect(describeRepoLink("  github.com/a/b  ")?.host).toBe("github");
  });
});
