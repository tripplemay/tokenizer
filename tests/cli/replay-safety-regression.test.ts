import { spawnSync } from "node:child_process";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { planBoundedReplay } from "../../src/cli/replay-contract";
import { dryRunBoundedReplay, executeBoundedReplay, readBoundedReplayFile } from "../../src/cli/replay";
import type { TokenizerConfig } from "../../src/cli/config";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function root() { const path = mkdtempSync(join(realpathSync(tmpdir()), "b03-safety-")); roots.push(path); return path; }
function row(cwd: string) {
  return JSON.stringify({ type: "assistant", uuid: "one", cwd, timestamp: "2026-10-07T12:00:00.000Z", message: { role: "assistant", id: "one", model: "claude-test", usage: { input_tokens: 1, output_tokens: 1 } } }) + "\n";
}
function plan(file: string, dryRun = true) {
  return planBoundedReplay({ source: "claude-code", file, from: "2026-10-07T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z", maxBytes: 1024 * 1024, maxEvents: 10, dryRun });
}
function config(projectRoots: string[], includePaths: string[]): TokenizerConfig {
  return { serverUrl: "https://example.invalid", projectRoots, sources: { claude: true, codex: false, opencode: false, aider: false, kimicode: false }, privacy: { mode: "local-only", includePaths, excludePaths: [] } };
}
const linkType = process.platform === "win32" ? "junction" : "dir";

it("R1 refuses parent symlink/junction traversal before reading the source", () => {
  const dir = root();
  const target = join(dir, "target");
  mkdirSync(target);
  writeFileSync(join(target, "session.jsonl"), row(target));
  const parent = join(dir, "parent-link");
  symlinkSync(target, parent, linkType);
  expect(() => readBoundedReplayFile(join(parent, "session.jsonl"), 1024 * 1024)).toThrow("non-symlink directory");
});

it.each(["afterPathStat", "afterRead"] as const)("R1 refuses a parent replaced by a same-target symlink/junction at %s", (stage) => {
  const dir = root();
  const parent = join(dir, "parent");
  const moved = join(dir, "moved");
  mkdirSync(parent);
  const file = join(parent, "session.jsonl");
  writeFileSync(file, row(parent));
  let mutationStage = "not-started";
  let caught: Error | undefined;
  try {
    readBoundedReplayFile(file, 1024 * 1024, { [stage]: () => {
      mutationStage = "started";
      renameSync(parent, moved);
      mutationStage = "renamed";
      symlinkSync(moved, parent, linkType);
      mutationStage = "linked";
    } });
  } catch (error) {
    caught = error as Error;
  }
  expect(caught?.message).toMatch(/^Replay refused:/);
  if (mutationStage === "linked") {
    expect(caught?.message).toMatch(/non-symlink directory|source parent changed|source changed/);
  } else {
    // Windows may refuse the adversarial rename while the leaf handle is open.
    // That still fails closed, but is not evidence that the junction race ran.
    expect(process.platform).toBe("win32");
    expect(mutationStage).not.toBe("not-started");
    expect(caught?.message).toContain("source could not be opened safely");
  }
});

it("R1 refuses a replaced regular parent even when a hardlink preserves the leaf inode", () => {
  const dir = root();
  const parent = join(dir, "parent");
  const moved = join(dir, "moved");
  mkdirSync(parent);
  const file = join(parent, "session.jsonl");
  writeFileSync(file, row(parent));
  expect(() => readBoundedReplayFile(file, 1024 * 1024, { afterPathStat: () => {
    renameSync(parent, moved);
    mkdirSync(parent);
    linkSync(join(moved, "session.jsonl"), file);
  } })).toThrow("source parent changed");
});

it("R3 binds workspace inference to confirmation even when only projectRoots changes", () => {
  const dir = root();
  const a = join(dir, "a");
  const b = join(a, "b");
  mkdirSync(b, { recursive: true });
  const file = join(dir, "session.jsonl");
  writeFileSync(file, row(b));
  const before = config([dir], [b]);
  const after = config([a], [b]);
  const previewBefore = dryRunBoundedReplay(plan(file), before);
  const previewAfter = dryRunBoundedReplay(plan(file), after);
  expect(previewBefore.wouldAdmit).toBe(0);
  expect(previewAfter.wouldAdmit).toBe(1);
  expect(previewAfter.planDigest).not.toBe(previewBefore.planDigest);
  const neverMerge = () => { throw new Error("MERGE_MUST_NOT_RUN"); };
  expect(() => executeBoundedReplay(plan(file, false), after, previewBefore.planDigest, { readCurrentConfig: () => after, mergeEvents: neverMerge })).toThrow("does not match");
  expect(() => executeBoundedReplay(plan(file, false), before, previewBefore.planDigest, { readCurrentConfig: () => after, mergeEvents: neverMerge })).toThrow("stale before queue admission");
}, 30_000);

it.skipIf(process.platform === "win32")("R2 safely refuses regular-file to FIFO swap without waiting for a writer", () => {
  const dir = root();
  const file = join(dir, "race.jsonl");
  writeFileSync(file, row(dir));
  const started = Date.now();
  const child = spawnSync(process.execPath, ["--import", "tsx", join(process.cwd(), "tests/fixtures/replay-fifo-safety.ts"), file], { encoding: "utf8", timeout: 12_000 });
  const elapsed = Date.now() - started;
  console.log("FIFO_FIXED", JSON.stringify({ elapsedMs: elapsed, errorCode: (child.error as NodeJS.ErrnoException | undefined)?.code, status: child.status, stdout: child.stdout }));
  expect(child.stdout).toContain("FIFO_CREATED");
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(0);
  expect(child.stdout).toContain("SAFE_REFUSAL");
  expect(elapsed).toBeLessThan(10_000);
}, 20_000);

it("refuses dot traversal instead of normalizing away a symlink ancestor", () => {
  const dir = root();
  const target = join(dir, "target");
  mkdirSync(target);
  writeFileSync(join(target, "session.jsonl"), row(target));
  expect(() => readBoundedReplayFile(`${dir}/target/../target/session.jsonl`, 1024 * 1024)).toThrow("dot traversal");
});

it("unchanged regular file remains usable and cursor bytes remain unchanged", () => {
  const dir = root();
  const file = join(dir, "plain with ' quote.jsonl");
  const cursor = join(dir, "cursor.json");
  writeFileSync(file, row(dir));
  writeFileSync(cursor, "cursor-sentinel\n");
  const current = config([], []);
  const preview = dryRunBoundedReplay(plan(file), current);
  expect(preview.wouldAdmit).toBe(1);
  expect(executeBoundedReplay(plan(file, false), current, preview.planDigest, { readCurrentConfig: () => current, mergeEvents: (events) => ({ events, added: events.length }) }).admitted).toBe(1);
  expect(readFileSync(cursor, "utf8")).toBe("cursor-sentinel\n");
});

it.skipIf(process.platform !== "win32").each([
  ["UNC", "\\\\localhost\\share\\session.jsonl", /local Windows drive file/],
  ["device", "\\\\.\\pipe\\session.jsonl", /absolute path without dot traversal|local Windows drive file/],
  ["alternate stream", "C:\\logs\\base:stream.jsonl", /local Windows drive file/]
] as const)("Windows refuses unsupported %s source before opening", (_kind, file, message) => {
  expect(() => readBoundedReplayFile(file, 1024)).toThrow(message);
});
