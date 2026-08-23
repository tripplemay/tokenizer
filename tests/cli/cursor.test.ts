import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendStartOffset, emptyCursor, recordFile, shouldSkipAppendOnlyFile, shouldSkipFile } from "@/cli/cursor";
import { readJsonlFile } from "@/parsers/jsonl";

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

  it("skips an append-only file when only its mtime changed", () => {
    const file = join(dir, "a.jsonl");
    writeFileSync(file, "{}\n");
    const cursor = emptyCursor();
    recordFile(file, cursor);
    const future = new Date(Date.now() + 60_000);
    utimesSync(file, future, future);

    expect(shouldSkipAppendOnlyFile(file, cursor)).toBe(true);
  });

  it("does not skip when the recorded file no longer exists", () => {
    const file = join(dir, "missing.txt");
    const cursor = emptyCursor();
    cursor.files[file] = { mtimeMs: 1234, size: 10 };
    expect(shouldSkipFile(file, cursor)).toBe(false);
  });

  it("returns the previous byte size when an append-only file grows", () => {
    const file = join(dir, "a.jsonl");
    const original = "{\"label\":\"\u00e9\"}\n";
    writeFileSync(file, original);
    const cursor = emptyCursor();
    recordFile(file, cursor);

    appendFileSync(file, "{}\n");

    expect(appendStartOffset(file, cursor)).toBe(Buffer.byteLength(original));
  });

  it("replays from byte zero when an append-only file shrinks", () => {
    const file = join(dir, "a.jsonl");
    writeFileSync(file, "long historical row\n");
    const cursor = emptyCursor();
    recordFile(file, cursor);

    writeFileSync(file, "{}\n");

    expect(shouldSkipAppendOnlyFile(file, cursor)).toBe(false);
    expect(appendStartOffset(file, cursor)).toBe(0);
  });

  it("uses UTF-8 byte offsets and retries an unterminated line after append", () => {
    const file = join(dir, "partial.jsonl");
    const prefix = '{"label":"\u9879\u76ee"';
    writeFileSync(file, prefix);

    const first = readJsonlFile(file);
    expect(first.byteLength).toBe(Buffer.byteLength(prefix));
    expect(first.lines).toEqual([
      { text: prefix, lineNumber: 1, endOffset: Buffer.byteLength(prefix) }
    ]);

    appendFileSync(file, "}\n");
    const completed = readJsonlFile(file);
    expect(completed.lines).toHaveLength(1);
    expect(JSON.parse(completed.lines[0].text)).toEqual({ label: "\u9879\u76ee" });
    expect(completed.lines[0].endOffset).toBeGreaterThan(first.byteLength);
    expect(completed.byteLength).toBe(Buffer.byteLength(`${prefix}}\n`));
  });
});
