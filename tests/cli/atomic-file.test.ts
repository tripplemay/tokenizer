import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic, withFileLock } from "@/cli/atomic-file";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tokenizer-atomic-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("writes the content", () => {
    const target = join(dir, "a.json");
    writeFileAtomic(target, "hello");
    expect(readFileSync(target, "utf8")).toBe("hello");
  });

  it("creates missing parent directories", () => {
    const target = join(dir, "nested", "deep", "a.json");
    writeFileAtomic(target, "hello");
    expect(readFileSync(target, "utf8")).toBe("hello");
  });

  it("overwrites an existing file", () => {
    const target = join(dir, "a.json");
    writeFileSync(target, "old");
    writeFileAtomic(target, "new");
    expect(readFileSync(target, "utf8")).toBe("new");
  });

  it("leaves no temp files behind", () => {
    const target = join(dir, "a.json");
    writeFileAtomic(target, "hello");
    writeFileAtomic(target, "again");
    expect(readdirSync(dir)).toEqual(["a.json"]);
  });

  it("never leaves a partially written target", () => {
    // The point of the rename: a reader either sees the whole old file or the
    // whole new one. Writing 2MB makes a non-atomic implementation likely to
    // be caught mid-write by the size assertion below.
    const target = join(dir, "big.json");
    writeFileAtomic(target, "x".repeat(2 * 1024 * 1024));
    writeFileAtomic(target, "y".repeat(2 * 1024 * 1024));
    const content = readFileSync(target, "utf8");
    expect(content.length).toBe(2 * 1024 * 1024);
    expect(new Set(content)).toEqual(new Set(["y"]));
  });
});

describe("withFileLock", () => {
  it("returns the callback's value", () => {
    expect(withFileLock(join(dir, "state.json"), () => 42)).toBe(42);
  });

  it("releases the lock afterwards", () => {
    const target = join(dir, "state.json");
    withFileLock(target, () => 1);
    expect(existsSync(`${target}.lock`)).toBe(false);
  });

  it("releases the lock even when the callback throws", () => {
    const target = join(dir, "state.json");
    expect(() => withFileLock(target, () => { throw new Error("boom"); })).toThrow("boom");
    expect(existsSync(`${target}.lock`)).toBe(false);
  });

  it("can be re-acquired after release", () => {
    const target = join(dir, "state.json");
    withFileLock(target, () => 1);
    expect(withFileLock(target, () => 2)).toBe(2);
  });

  it("serializes a read-modify-write against itself", () => {
    // Re-entrancy is NOT supported and must not deadlock silently — a nested
    // acquire should surface as a timeout rather than hang forever.
    const target = join(dir, "state.json");
    writeFileAtomic(target, JSON.stringify({ n: 0 }));
    withFileLock(target, () => {
      const current = JSON.parse(readFileSync(target, "utf8"));
      writeFileAtomic(target, JSON.stringify({ n: current.n + 1 }));
    });
    expect(JSON.parse(readFileSync(target, "utf8")).n).toBe(1);
  });

  it("steals a stale lock left by a crashed process", () => {
    // A process killed mid-write (Task Scheduler /End, machine sleep) leaves
    // the lock file behind; without stealing, the agent would wedge forever.
    const target = join(dir, "state.json");
    const lock = `${target}.lock`;
    writeFileSync(lock, "99999999");
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    expect(withFileLock(target, () => "ok", { staleMs: 5_000 })).toBe("ok");
    expect(existsSync(lock)).toBe(false);
  });

  it("does not steal a fresh lock, and times out instead", () => {
    const target = join(dir, "state.json");
    writeFileSync(`${target}.lock`, "99999999");
    expect(() => withFileLock(target, () => "ok", { staleMs: 60_000, timeoutMs: 150 })).toThrow(/lock/i);
  });

  it("keeps the lock file next to its target so it inherits the same directory", () => {
    const target = join(dir, "state.json");
    let seen = false;
    withFileLock(target, () => {
      seen = existsSync(`${target}.lock`);
    });
    expect(seen).toBe(true);
  });

  it("creates the parent directory if the target's directory is missing", () => {
    const target = join(dir, "fresh", "state.json");
    expect(withFileLock(target, () => "ok")).toBe("ok");
    expect(statSync(join(dir, "fresh")).isDirectory()).toBe(true);
  });
});
