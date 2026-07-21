import { describe, expect, it } from "vitest";
import { isPathUnder, isWindowsPath, normalizeWorkspacePath, pathCacheKey, pathSegments } from "@/shared/path";

describe("isWindowsPath", () => {
  it("detects drive-letter paths with either separator", () => {
    expect(isWindowsPath("C:\\Users\\me\\proj")).toBe(true);
    expect(isWindowsPath("C:/Users/me/proj")).toBe(true);
    expect(isWindowsPath("d:\\proj")).toBe(true);
  });

  it("detects UNC paths", () => {
    expect(isWindowsPath("\\\\server\\share\\proj")).toBe(true);
  });

  it("does not treat POSIX paths as Windows paths", () => {
    expect(isWindowsPath("/Users/me/proj")).toBe(false);
    expect(isWindowsPath("/home/me/weird\\dir")).toBe(false);
    expect(isWindowsPath("relative/path")).toBe(false);
    expect(isWindowsPath("")).toBe(false);
  });
});

describe("normalizeWorkspacePath", () => {
  // The whole point of shape-based detection: an existing POSIX install must
  // observe byte-identical output, because workspacePath feeds the
  // userId_workspacePath unique index server-side.
  it("leaves POSIX paths untouched", () => {
    expect(normalizeWorkspacePath("/Users/me/proj")).toBe("/Users/me/proj");
    expect(normalizeWorkspacePath("/home/me/a-b_c.d")).toBe("/home/me/a-b_c.d");
  });

  it("leaves a POSIX path containing a backslash untouched", () => {
    // A backslash is a legal filename character on POSIX; splitting on it
    // would corrupt the path.
    expect(normalizeWorkspacePath("/home/me/weird\\dir")).toBe("/home/me/weird\\dir");
  });

  it("converts forward slashes to backslashes for Windows paths", () => {
    // `git rev-parse --show-toplevel` emits this form even on Windows.
    expect(normalizeWorkspacePath("C:/Users/me/proj")).toBe("C:\\Users\\me\\proj");
  });

  it("uppercases the drive letter", () => {
    expect(normalizeWorkspacePath("c:\\Users\\me\\proj")).toBe("C:\\Users\\me\\proj");
  });

  it("collapses git output and native tool output to the same string", () => {
    const fromGit = normalizeWorkspacePath("C:/Users/me/proj");
    const fromLogs = normalizeWorkspacePath("c:\\Users\\me\\proj");
    expect(fromGit).toBe(fromLogs);
  });

  it("preserves case of path segments", () => {
    expect(normalizeWorkspacePath("C:\\Users\\Me\\MyProj")).toBe("C:\\Users\\Me\\MyProj");
  });

  it("strips trailing separators from Windows paths", () => {
    expect(normalizeWorkspacePath("C:\\Users\\me\\proj\\")).toBe("C:\\Users\\me\\proj");
    expect(normalizeWorkspacePath("C:/Users/me/proj/")).toBe("C:\\Users\\me\\proj");
  });

  it("does not even strip a trailing slash from a POSIX path", () => {
    // Deliberately identity, not cosmetic tidying: workspacePath feeds a
    // unique index, so POSIX output must be provably byte-identical.
    expect(normalizeWorkspacePath("/Users/me/proj/")).toBe("/Users/me/proj/");
  });

  it("keeps the drive root intact", () => {
    expect(normalizeWorkspacePath("C:\\")).toBe("C:\\");
    expect(normalizeWorkspacePath("c:/")).toBe("C:\\");
  });

  it("keeps the POSIX root intact", () => {
    expect(normalizeWorkspacePath("/")).toBe("/");
  });

  it("normalizes backslash UNC paths on any platform", () => {
    expect(normalizeWorkspacePath("\\\\server\\share\\proj\\", "linux")).toBe("\\\\server\\share\\proj");
  });

  it("normalizes forward-slash UNC only when actually running on Windows", () => {
    // `git rev-parse --show-toplevel` emits "//server/share/proj" on Windows,
    // but "//x" is also a legal POSIX absolute path — so shape alone can't
    // decide this one, and we defer to the real platform.
    expect(normalizeWorkspacePath("//server/share/proj", "win32")).toBe("\\\\server\\share\\proj");
    expect(normalizeWorkspacePath("//server/share/proj", "linux")).toBe("//server/share/proj");
  });

  it("collapses repeated interior separators", () => {
    expect(normalizeWorkspacePath("C:\\Users\\\\me\\proj")).toBe("C:\\Users\\me\\proj");
  });

  it("passes null-ish input through unchanged", () => {
    expect(normalizeWorkspacePath("")).toBe("");
  });
});

describe("pathCacheKey", () => {
  it("is case-insensitive for Windows paths", () => {
    // NTFS is case-insensitive; keying on exact case makes one file look like
    // two, re-parsing it and re-emitting every event.
    expect(pathCacheKey("C:\\Proj\\File.jsonl")).toBe(pathCacheKey("c:\\proj\\file.jsonl"));
  });

  it("unifies separator style for Windows paths", () => {
    expect(pathCacheKey("C:/Proj/File.jsonl")).toBe(pathCacheKey("C:\\Proj\\File.jsonl"));
  });

  it("stays case-sensitive for POSIX paths", () => {
    // ext4/APFS-case-sensitive treat these as distinct files.
    expect(pathCacheKey("/Users/me/File")).not.toBe(pathCacheKey("/Users/me/file"));
  });

  it("is identity for POSIX paths", () => {
    expect(pathCacheKey("/Users/me/proj")).toBe("/Users/me/proj");
  });
});

describe("isPathUnder", () => {
  it("matches the directory itself", () => {
    expect(isPathUnder("/home/me/.claude", "/home/me/.claude")).toBe(true);
    expect(isPathUnder("C:\\Users\\me\\.claude", "C:\\Users\\me\\.claude")).toBe(true);
  });

  it("matches descendants on POSIX", () => {
    expect(isPathUnder("/home/me/.claude/projects/a.jsonl", "/home/me/.claude")).toBe(true);
  });

  it("matches descendants on Windows across separator styles", () => {
    // The real bug: cursor keys use "\" while the computed root may use "/".
    expect(isPathUnder("C:\\Users\\me\\.claude\\projects\\a.jsonl", "C:/Users/me/.claude")).toBe(true);
  });

  it("matches descendants on Windows across letter case", () => {
    expect(isPathUnder("c:\\users\\me\\.claude\\projects\\a.jsonl", "C:\\Users\\Me\\.claude")).toBe(true);
  });

  it("rejects a sibling with a shared prefix", () => {
    // "/home/me/.claude-backup" must not count as inside "/home/me/.claude".
    expect(isPathUnder("/home/me/.claude-backup/a.jsonl", "/home/me/.claude")).toBe(false);
    expect(isPathUnder("C:\\Users\\me\\.claude-backup\\a", "C:\\Users\\me\\.claude")).toBe(false);
  });

  it("rejects unrelated paths", () => {
    expect(isPathUnder("/home/me/.codex/sessions/a.jsonl", "/home/me/.claude")).toBe(false);
  });

  it("stays case-sensitive on POSIX", () => {
    expect(isPathUnder("/home/me/.Claude/a.jsonl", "/home/me/.claude")).toBe(false);
  });
});

describe("pathSegments", () => {
  it("splits POSIX paths", () => {
    expect(pathSegments("/home/me/.claude/projects")).toEqual(["home", "me", ".claude", "projects"]);
  });

  it("splits Windows paths and drops the drive", () => {
    expect(pathSegments("C:\\Users\\me\\.claude\\projects")).toEqual(["Users", "me", ".claude", "projects"]);
  });

  it("splits Windows paths given in forward-slash form", () => {
    expect(pathSegments("C:/Users/me/.claude")).toEqual(["Users", "me", ".claude"]);
  });

  it("supports the directory-name membership test the claude parser needs", () => {
    expect(pathSegments("C:\\Users\\me\\.claude\\projects\\a.jsonl")).toContain(".claude");
    expect(pathSegments("/home/me/.claude/projects/a.jsonl")).toContain(".claude");
    expect(pathSegments("/home/me/.claude-backup/a.jsonl")).not.toContain(".claude");
  });

  it("returns an empty array for empty input", () => {
    expect(pathSegments("")).toEqual([]);
  });
});
