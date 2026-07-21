import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { restrictToCurrentUser } from "@/cli/file-permissions";

let dir: string;
let target: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tokenizer-perm-"));
  target = join(dir, "credentials.json");
  writeFileSync(target, "{}");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("restrictToCurrentUser", () => {
  it("chmods to 0600 on POSIX", () => {
    const result = restrictToCurrentUser(target, "linux");
    expect(result).toEqual({ ok: true, method: "chmod" });
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it("reports failure instead of throwing when the file is gone", () => {
    rmSync(target);
    const result = restrictToCurrentUser(target, "linux");
    expect(result.ok).toBe(false);
    expect(result.method).toBe("chmod");
    expect(result.error).toBeTruthy();
  });

  it("reports a skip on Windows when USERNAME is unavailable", () => {
    // Better to say "I could not restrict this" than to silently leave a
    // world-readable device token behind.
    const original = process.env.USERNAME;
    delete process.env.USERNAME;
    try {
      const result = restrictToCurrentUser(target, "win32");
      expect(result.ok).toBe(false);
      expect(result.method).toBe("skipped");
    } finally {
      if (original === undefined) delete process.env.USERNAME;
      else process.env.USERNAME = original;
    }
  });

  it("never silently succeeds on Windows without doing anything", () => {
    // Guards the actual regression: chmod on win32 is a no-op that returns
    // cleanly, which is exactly what made this a silent hole.
    const original = process.env.USERNAME;
    delete process.env.USERNAME;
    try {
      expect(restrictToCurrentUser(target, "win32").method).not.toBe("chmod");
    } finally {
      if (original === undefined) delete process.env.USERNAME;
      else process.env.USERNAME = original;
    }
  });
});
