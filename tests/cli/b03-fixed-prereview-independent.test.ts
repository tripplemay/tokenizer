import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { dryRunBoundedReplay, executeBoundedReplay, readBoundedReplayFile } from "@/cli/replay";
import { planBoundedReplay } from "@/cli/replay-contract";
import type { TokenizerConfig } from "@/cli/config";
import { mergeQueue } from "@/cli/collect";

const roots: string[] = [];
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });
function fixture() { const dir = mkdtempSync(join(realpathSync(tmpdir()), "independent-b03-")); roots.push(dir); return dir; }
function row(cwd: string, id = "one") { return JSON.stringify({ type: "assistant", uuid: id, cwd, timestamp: "2026-10-07T12:00:00.000Z", message: { role: "assistant", id, model: "fixture-model", usage: { input_tokens: 1, output_tokens: 2 } }, secret: "RAW_SECRET" }) + "\n"; }
function plan(file: string, dryRun = true) { return planBoundedReplay({ source: "claude-code", file, from: "2026-10-07T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z", maxBytes: 100_000, maxEvents: 10, dryRun }); }
function config(includePaths: string[] = [], excludePaths: string[] = []): TokenizerConfig { return { serverUrl: "http://127.0.0.1:9", projectRoots: [], sources: { claude: true, codex: false, opencode: false, aider: false, kimicode: false }, privacy: { mode: "local-only", includePaths, excludePaths } }; }

it("positive control: physical ordinary file admits minimized rows, retaining unrelated durable backlog", () => {
  const dir = fixture(); const file = join(dir, "source.jsonl"); const queue = join(dir, "queue.jsonl");
  writeFileSync(file, row(dir)); writeFileSync(queue, JSON.stringify({ source: "claude-code", sourceEventId: "legacy", occurredAt: "2020-01-01T00:00:00.000Z" }) + "\n");
  const cfg = config(); const preview = dryRunBoundedReplay(plan(file), cfg, 1);
  expect(preview.wouldAdmit).toBe(1); expect(JSON.stringify(preview)).not.toContain("RAW_SECRET");
  const result = executeBoundedReplay(plan(file, false), cfg, preview.planDigest, { readCurrentConfig: () => cfg, mergeEvents: (events) => mergeQueue(events, queue) });
  expect(result).toMatchObject({ admitted: 1, backlog: 2 }); expect(readFileSync(queue, "utf8")).not.toContain("RAW_SECRET");
});

it.each(["afterPathStat", "afterRead"] as const)("parent identity negative at %s reaches race hook and rejects a hardlinked leaf under a replacement directory", (stage) => {
  const dir = fixture(); const parent = join(dir, "parent"); const moved = join(dir, "moved"); mkdirSync(parent);
  const file = join(parent, "source.jsonl"); writeFileSync(file, row(dir)); let reached = false;
  expect(() => readBoundedReplayFile(file, 100_000, { [stage]: () => { reached = true; renameSync(parent, moved); mkdirSync(parent); linkSync(join(moved, "source.jsonl"), file); } })).toThrow("source parent changed");
  expect(reached).toBe(true);
});

it("source path negative: parent symlink and explicit dot components fail closed", () => {
  const dir = fixture(); const parent = join(dir, "parent"); mkdirSync(parent); writeFileSync(join(parent, "source.jsonl"), row(dir));
  symlinkSync(parent, join(dir, "alias"), "dir");
  expect(() => readBoundedReplayFile(join(dir, "alias", "source.jsonl"), 100_000)).toThrow("non-symlink directory");
  for (const file of [`${parent}/./source.jsonl`, `${parent}/../parent/source.jsonl`]) expect(() => readBoundedReplayFile(file, 100_000)).toThrow("dot traversal");
});

it.skipIf(process.platform === "win32")("FIFO negative: independent timed child reaches regular-to-FIFO swap and returns without writer", () => {
  const dir = fixture(); const file = join(dir, "source.jsonl"); writeFileSync(file, row(dir));
  const child = spawnSync(process.execPath, ["--import", "tsx", join(process.cwd(), "tests/fixtures/replay-fifo-safety.ts"), file], { encoding: "utf8", timeout: 3000 });
  console.log("INDEPENDENT_FIFO", JSON.stringify({ status: child.status, error: child.error?.message, stdout: child.stdout }));
  expect(child.error).toBeUndefined(); expect(child.status).toBe(0); expect(child.stdout).toContain("FIFO_CREATED"); expect(child.stdout).toContain("opened source is not a regular file");
});

it("final confirmation negatives: projectRoots, same-size content, and privacy mode changes never call admission", () => {
  const dir = fixture(); const file = join(dir, "source.jsonl"); writeFileSync(file, row(dir));
  const cfg = config(); const digest = dryRunBoundedReplay(plan(file), cfg).planDigest; const merge = vi.fn(() => ({ events: [], added: 0 }));
  for (const changed of [{ ...cfg, projectRoots: [dir] }, { ...cfg, privacy: { ...cfg.privacy!, mode: "sync" as const } }]) {
    expect(() => executeBoundedReplay(plan(file, false), cfg, digest, { readCurrentConfig: () => changed, mergeEvents: merge })).toThrow("stale");
  }
  expect(() => executeBoundedReplay(plan(file, false), cfg, digest, { readCurrentConfig: () => { writeFileSync(file, row(dir, "two")); return cfg; }, mergeEvents: merge })).toThrow("stale");
  expect(merge).not.toHaveBeenCalled();
});

it("file mutation negative reaches afterRead and rejects growth", () => {
  const dir = fixture(); const file = join(dir, "source.jsonl"); writeFileSync(file, row(dir)); let reached = false;
  expect(() => readBoundedReplayFile(file, 100_000, { afterRead: () => { reached = true; appendFileSync(file, row(dir, "new")); } })).toThrow("changed while being read"); expect(reached).toBe(true);
});

it("privacy path safety: dot alias for excluded real workspace must not be admitted", () => {
  const dir = fixture(); const allowed = join(dir, "allowed"); const denied = join(dir, "denied"); mkdirSync(allowed); mkdirSync(denied);
  const file = join(dir, "source.jsonl"); const cfg = config([allowed], [denied]);
  writeFileSync(file, row(denied)); expect(dryRunBoundedReplay(plan(file), cfg).wouldAdmit).toBe(0);
  writeFileSync(file, row(`${allowed}/../denied`));
  const preview = dryRunBoundedReplay(plan(file), cfg); console.log("DOT_PRIVACY", JSON.stringify(preview));
  expect(preview.wouldAdmit).toBe(0);
});

it.skipIf(process.platform === "win32")("privacy path safety: Git enrichment exposing excluded canonical workspace must not enter queue", () => {
  const dir = fixture(); const denied = join(dir, "denied"); const alias = join(dir, "allowed"); mkdirSync(denied); execFileSync("git", ["init", "--quiet", denied]); symlinkSync(denied, alias, "dir");
  const file = join(dir, "source.jsonl"); const queue = join(dir, "queue.jsonl"); writeFileSync(file, row(alias)); const cfg = config([alias], [denied]);
  const preview = dryRunBoundedReplay(plan(file), cfg);
  const result = executeBoundedReplay(plan(file, false), cfg, preview.planDigest, { readCurrentConfig: () => cfg, mergeEvents: (events) => mergeQueue(events, queue) });
  console.log("GIT_ALIAS_PRIVACY", JSON.stringify({ result, queue: readFileSync(queue, "utf8") }));
  expect(result.admitted).toBe(0);
});
