import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyCursor, recordFile, shouldSkipFile } from "@/cli/cursor";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tk-cursor-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("cursor", () => {
  it("does not skip an unseen file", () => {
    const file = join(dir, "a.txt");
    writeFileSync(file, "hello");
    expect(shouldSkipFile(file, emptyCursor())).toBe(false);
  });

  it("skips a recorded file when mtime and size are unchanged", () => {
    const file = join(dir, "a.txt");
    writeFileSync(file, "hello");
    const cursor = emptyCursor();
    recordFile(file, cursor);
    expect(shouldSkipFile(file, cursor)).toBe(true);
  });

  it("does not skip a file whose size grew", () => {
    const file = join(dir, "a.txt");
    writeFileSync(file, "hello");
    const cursor = emptyCursor();
    recordFile(file, cursor);
    writeFileSync(file, "hello world");
    expect(shouldSkipFile(file, cursor)).toBe(false);
  });

  it("does not skip a file whose mtime changed even if size matches", () => {
    const file = join(dir, "a.txt");
    writeFileSync(file, "hello");
    const cursor = emptyCursor();
    recordFile(file, cursor);
    const future = new Date(Date.now() + 60_000);
    utimesSync(file, future, future);
    expect(shouldSkipFile(file, cursor)).toBe(false);
  });

  it("does not skip when the recorded file no longer exists", () => {
    const file = join(dir, "missing.txt");
    const cursor = emptyCursor();
    cursor.files[file] = { mtimeMs: 1234, size: 10 };
    expect(shouldSkipFile(file, cursor)).toBe(false);
  });
});
