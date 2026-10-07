import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { collectEvents, mergeQueue } from "@/cli/collect";
import { filterUsageEvents } from "@/cli/privacy";
import * as gitEnrichment from "@/cli/git";
import { dryRunBoundedReplay, executeBoundedReplay } from "@/cli/replay";
import { planBoundedReplay } from "@/cli/replay-contract";
import type { TokenizerConfig } from "@/cli/config";
import type { UsageEventInput } from "@/shared/usage";

const home = vi.hoisted(() => ({ value: "" }));
vi.mock("node:os", async (original) => ({ ...await original<typeof import("node:os")>(), homedir: () => home.value }));
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });
function fixture() { const dir = mkdtempSync(join(realpathSync(tmpdir()), "b03-scope-")); dirs.push(dir); home.value = dir; return dir; }
const linkType = process.platform === "win32" ? "junction" : "dir";
function event(workspacePath: string, localWorkspacePath?: string): UsageEventInput {
  return { source: "claude-code", sourceEventId: "stable-id", workspacePath, localWorkspacePath, occurredAt: "2026-10-07T12:00:00.000Z" };
}
function config(includePaths: string[], excludePaths: string[] = []): TokenizerConfig {
  return { serverUrl: "http://127.0.0.1:9", projectRoots: [], sources: { claude: true, codex: false, opencode: false, aider: false, kimicode: false }, privacy: { mode: "local-only", includePaths, excludePaths } };
}
function source(dir: string, cwd: string) {
  const parent = join(dir, ".claude", "projects", "fixture"); mkdirSync(parent, { recursive: true });
  const file = join(parent, "session.jsonl");
  writeFileSync(file, JSON.stringify({ type: "assistant", uuid: "one", cwd, timestamp: "2026-10-07T12:00:00.000Z", message: { role: "assistant", id: "one", model: "fixture", usage: { input_tokens: 1, output_tokens: 2 } }, secret: "NEVER_STORE_RAW" }) + "\n");
  return file;
}
function plan(file: string, dryRun = true) {
  return planBoundedReplay({ source: "claude-code", file, from: "2026-10-07T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z", maxBytes: 100_000, maxEvents: 10, dryRun });
}
function assertNoAdmission(dir: string, cwd: string, cfg: TokenizerConfig) {
  const file = source(dir, cwd);
  const preview = dryRunBoundedReplay(plan(file), cfg);
  expect(preview.parsed).toBe(1);
  expect(preview.wouldAdmit).toBe(0);
  const queue = join(dir, "queue.jsonl");
  const legacy = { ...event("/previously-admitted"), gitRemote: null, repoKey: null };
  writeFileSync(queue, JSON.stringify(legacy) + "\n");
  const result = executeBoundedReplay(plan(file, false), cfg, preview.planDigest, { readCurrentConfig: () => cfg, mergeEvents: (events) => mergeQueue(events, queue) });
  expect(result).toMatchObject({ admitted: 0, backlog: 1 });
  expect(JSON.parse(readFileSync(queue, "utf8").trim())).toEqual(legacy);
  expect(collectEvents(cfg).events).toEqual([]);
}

it("R4 dot alias to an excluded workspace is rejected by preview, replay and ordinary collection", () => {
  const dir = fixture(); const allowed = join(dir, "allowed"); const denied = join(dir, "denied");
  mkdirSync(allowed); mkdirSync(denied); const cfg = config([allowed], [denied]);
  expect(filterUsageEvents([event(denied)], cfg.privacy!)).toEqual([]);
  assertNoAdmission(dir, `${allowed}/../denied`, cfg);
});

it("R5 an allowed symlink/junction to an excluded Git repo never reaches durable admission", () => {
  const dir = fixture(); const denied = join(dir, "denied"); const alias = join(dir, "allowed");
  mkdirSync(denied); execFileSync("git", ["init", "--quiet", denied]); symlinkSync(denied, alias, linkType);
  assertNoAdmission(dir, alias, config([alias], [denied]));
});

it("an alias into a target outside the include scope is not rescued by any other allowed path", () => {
  const dir = fixture(); const allowed = join(dir, "allowed"); const outside = join(dir, "outside");
  mkdirSync(allowed); mkdirSync(outside); execFileSync("git", ["init", "--quiet", outside]);
  const alias = join(allowed, "alias"); symlinkSync(outside, alias, linkType);
  const cfg = config([allowed]);
  expect(filterUsageEvents([event(allowed, alias), event(alias, allowed)], cfg.privacy!)).toEqual([]);
  assertNoAdmission(dir, alias, cfg);
});

it("nonexistent descendants still resolve their existing symlink ancestor for scope admission", () => {
  const dir = fixture(); const allowed = join(dir, "allowed"); const denied = join(dir, "denied");
  mkdirSync(allowed); mkdirSync(denied); const alias = join(allowed, "alias"); symlinkSync(denied, alias, linkType);
  const cfg = config([allowed], [denied]);
  expect(filterUsageEvents([event(join(alias, "not-yet-created", "project"))], cfg.privacy!)).toEqual([]);
});

it("broken symlink/junction resolution fails closed instead of treating the link as a missing directory", () => {
  const dir = fixture(); const target = join(dir, "target"); const alias = join(dir, "alias");
  mkdirSync(target); symlinkSync(target, alias, linkType); rmSync(target, { recursive: true });
  expect(filterUsageEvents([event(alias)], config([dir]).privacy!)).toEqual([]);
  expect(filterUsageEvents([event(join(alias, "child"))], config([dir]).privacy!)).toEqual([]);
});

it("every workspace path must satisfy include; excludes take precedence on every path", () => {
  const dir = fixture(); const allowed = join(dir, "allowed"); const denied = join(dir, "denied"); mkdirSync(allowed); mkdirSync(denied);
  const cfg = config([allowed], [denied]);
  expect(filterUsageEvents([event(allowed, denied), event(denied, allowed)], cfg.privacy!)).toEqual([]);
});

it("scope is checked again when enrichment introduces a different excluded workspace", () => {
  const dir = fixture(); const allowed = join(dir, "allowed"); const denied = join(dir, "denied"); mkdirSync(allowed); mkdirSync(denied);
  const cfg = config([allowed], [denied]);
  expect(filterUsageEvents([event(allowed)], cfg.privacy!)).toHaveLength(1);
  vi.spyOn(gitEnrichment, "enrichEventsWithGit").mockImplementation((events) => events.map((row) => ({ ...row, localWorkspacePath: denied })));
  assertNoAdmission(dir, allowed, cfg);
});

it("Windows mixed separators, traversal and conflicting aliases cannot bypass scope on any host", () => {
  const cfg = config(["C:\\allowed"], ["C:\\denied"]);
  expect(filterUsageEvents([event("c:/allowed/../denied"), event("C:\\allowed", "C:\\denied")], cfg.privacy!)).toEqual([]);
});

it("an allowed physical target keeps legacy event identity and path bytes unchanged", () => {
  const dir = fixture(); const allowed = join(dir, "allowed"); mkdirSync(allowed);
  const alias = join(dir, "alias"); symlinkSync(allowed, alias, linkType);
  const input = event(alias); const cfg = config([allowed]);
  expect(filterUsageEvents([input], cfg.privacy!)).toEqual([input]);
  expect(input).toEqual(event(alias));
  const file = source(dir, alias); const preview = dryRunBoundedReplay(plan(file), cfg); expect(preview.wouldAdmit).toBe(1);
  const result = executeBoundedReplay(plan(file, false), cfg, preview.planDigest, { readCurrentConfig: () => cfg, mergeEvents: (events) => {
    expect(events[0].workspacePath).toBe(alias); expect(events[0].sourceEventId).toBe("claude-jsonl:one:one");
    expect(JSON.stringify(events)).not.toContain("NEVER_STORE_RAW");
    return { events, added: events.length };
  } });
  expect(result.admitted).toBe(1);
});

it("retargeting a workspace alias cannot reuse a zero-admission confirmation for newly eligible rows", () => {
  const dir = fixture(); const allowed = join(dir, "allowed"); const denied = join(dir, "denied"); const alias = join(dir, "alias");
  mkdirSync(allowed); mkdirSync(denied); symlinkSync(denied, alias, linkType);
  const file = source(dir, alias); const cfg = config([allowed], [denied]);
  const before = dryRunBoundedReplay(plan(file), cfg); expect(before.wouldAdmit).toBe(0);
  rmSync(alias); symlinkSync(allowed, alias, linkType);
  const after = dryRunBoundedReplay(plan(file), cfg); expect(after.wouldAdmit).toBe(1);
  expect(after.planDigest).not.toBe(before.planDigest);
  const merge = vi.fn(() => ({ events: [], added: 0 }));
  expect(() => executeBoundedReplay(plan(file, false), cfg, before.planDigest, { readCurrentConfig: () => cfg, mergeEvents: merge })).toThrow("does not match");
  expect(merge).not.toHaveBeenCalled();
});

it("confirmation binds physical targets even when the count and wire payload stay the same", () => {
  const dir = fixture(); const a = join(dir, "a"); const b = join(dir, "b"); const alias = join(dir, "alias");
  mkdirSync(a); mkdirSync(b); symlinkSync(a, alias, linkType);
  const file = source(dir, alias); const cfg = config([dir]);
  const before = dryRunBoundedReplay(plan(file), cfg); expect(before.wouldAdmit).toBe(1);
  rmSync(alias); symlinkSync(b, alias, linkType);
  const after = dryRunBoundedReplay(plan(file), cfg); expect(after.wouldAdmit).toBe(1);
  expect(after.planDigest).not.toBe(before.planDigest);
  const merge = vi.fn(() => ({ events: [], added: 0 }));
  expect(() => executeBoundedReplay(plan(file, false), cfg, before.planDigest, { readCurrentConfig: () => cfg, mergeEvents: merge })).toThrow("does not match");
  expect(merge).not.toHaveBeenCalled();
});

it("same-count different rows and retargeting immediately before merge invalidate confirmation", () => {
  const dir = fixture(); const allowed = join(dir, "allowed"); const denied = join(dir, "denied"); const a = join(dir, "a"); const b = join(dir, "b");
  mkdirSync(allowed); mkdirSync(denied); symlinkSync(allowed, a, linkType); symlinkSync(denied, b, linkType);
  const file = source(dir, a);
  appendFileSync(file, JSON.stringify({ type: "assistant", uuid: "two", cwd: b, timestamp: "2026-10-07T12:00:00.000Z", message: { role: "assistant", id: "two", usage: { input_tokens: 1 } } }) + "\n");
  const cfg = config([allowed], [denied]);
  const before = dryRunBoundedReplay(plan(file), cfg); expect(before.wouldAdmit).toBe(1);
  const swap = () => { rmSync(a); rmSync(b); symlinkSync(denied, a, linkType); symlinkSync(allowed, b, linkType); };
  const merge = vi.fn(() => ({ events: [], added: 0 }));
  expect(() => executeBoundedReplay(plan(file, false), cfg, before.planDigest, { readCurrentConfig: () => { swap(); return cfg; }, mergeEvents: merge })).toThrow("became stale");
  expect(merge).not.toHaveBeenCalled();
  const after = dryRunBoundedReplay(plan(file), cfg); expect(after.wouldAdmit).toBe(1);
  expect(after.planDigest).not.toBe(before.planDigest);
});

it("confirmation binds complete candidate payloads, not only event counts or IDs", () => {
  const dir = fixture(); const file = source(dir, dir); const cfg = config([dir]); let branch = "before";
  vi.spyOn(gitEnrichment, "enrichEventsWithGit").mockImplementation((events) => events.map((row) => ({ ...row, gitBranch: branch })));
  const before = dryRunBoundedReplay(plan(file), cfg); expect(before.wouldAdmit).toBe(1);
  branch = "after";
  const after = dryRunBoundedReplay(plan(file), cfg); expect(after.wouldAdmit).toBe(1); expect(after.planDigest).not.toBe(before.planDigest);
  branch = "before";
  const merge = vi.fn(() => ({ events: [], added: 0 }));
  expect(() => executeBoundedReplay(plan(file, false), cfg, before.planDigest, { readCurrentConfig: () => { branch = "after"; return cfg; }, mergeEvents: merge })).toThrow("became stale");
  expect(merge).not.toHaveBeenCalled();
});
