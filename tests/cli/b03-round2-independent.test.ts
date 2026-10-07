import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { dryRunBoundedReplay, executeBoundedReplay } from "@/cli/replay";
import { planBoundedReplay } from "@/cli/replay-contract";
import { filterUsageEvents } from "@/cli/privacy";
import * as git from "@/cli/git";
import type { TokenizerConfig } from "@/cli/config";
import type { UsageEventInput } from "@/shared/usage";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() { const dir = mkdtempSync(join(realpathSync(tmpdir()), "b03-round2-")); roots.push(dir); return dir; }
const linkType = process.platform === "win32" ? "junction" : "dir";
function cfg(includePaths: string[], excludePaths: string[] = []): TokenizerConfig { return { serverUrl: "http://127.0.0.1:9", projectRoots: [], sources: { claude: true, codex: false, opencode: false, aider: false, kimicode: false }, privacy: { mode: "local-only", includePaths, excludePaths } }; }
function event(path: string): UsageEventInput { return { source: "claude-code", sourceEventId: "stable", occurredAt: "2026-10-07T12:00:00.000Z", workspacePath: path }; }
function row(path: string, id = "a") { return JSON.stringify({ type: "assistant", uuid: id, cwd: path, timestamp: "2026-10-07T12:00:00.000Z", message: { role: "assistant", id, usage: { input_tokens: 1, output_tokens: 2 } } }) + "\n"; }
function plan(file: string, dryRun = true) { return planBoundedReplay({ source: "claude-code", file, from: "2026-10-07T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z", maxBytes: 100_000, maxEvents: 10, dryRun }); }
function link(target: string, alias: string) { rmSync(alias, { force: true }); symlinkSync(target, alias, linkType); }

it.each([false, true])("0-to-1 symlink retarget invalidates confirmation (final config boundary=%s)", (finalBoundary) => {
  const dir = fixture(); const allowed = join(dir, "allowed"); const denied = join(dir, "denied"); const alias = join(dir, "alias"); mkdirSync(allowed); mkdirSync(denied); link(denied, alias);
  const file = join(dir, "source.jsonl"); writeFileSync(file, row(alias)); const config = cfg([allowed], [denied]);
  const preview = dryRunBoundedReplay(plan(file), config); expect(preview.wouldAdmit).toBe(0); const merge = vi.fn(() => ({ events: [], added: 0 }));
  if (!finalBoundary) link(allowed, alias);
  expect(() => executeBoundedReplay(plan(file, false), config, preview.planDigest, { readCurrentConfig: () => { if (finalBoundary) link(allowed, alias); return config; }, mergeEvents: merge })).toThrow(/does not match|became stale/);
  const after = dryRunBoundedReplay(plan(file), config); expect(after.wouldAdmit).toBe(1); expect(after.planDigest).not.toBe(preview.planDigest); expect(merge).not.toHaveBeenCalled();
});

it("same admission count but different selected event cannot reuse digest at final boundary", () => {
  const dir = fixture(); const allowed = join(dir, "allowed"); const denied = join(dir, "denied"); const a = join(dir, "a"); const b = join(dir, "b"); mkdirSync(allowed); mkdirSync(denied); link(allowed, a); link(denied, b);
  const file = join(dir, "source.jsonl"); writeFileSync(file, row(a, "a")); appendFileSync(file, row(b, "b")); const config = cfg([allowed], [denied]);
  const preview = dryRunBoundedReplay(plan(file), config); expect(preview.wouldAdmit).toBe(1); const merge = vi.fn(() => ({ events: [], added: 0 }));
  expect(() => executeBoundedReplay(plan(file, false), config, preview.planDigest, { readCurrentConfig: () => { link(denied, a); link(allowed, b); return config; }, mergeEvents: merge })).toThrow("became stale");
  const after = dryRunBoundedReplay(plan(file), config); expect(after.wouldAdmit).toBe(1); expect(after.planDigest).not.toBe(preview.planDigest); expect(merge).not.toHaveBeenCalled();
});

it("same event and wire payload but different physical target invalidates digest", () => {
  const dir = fixture(); const a = join(dir, "a"); const b = join(dir, "b"); const alias = join(dir, "alias"); mkdirSync(a); mkdirSync(b); link(a, alias);
  const file = join(dir, "source.jsonl"); writeFileSync(file, row(alias)); const config = cfg([dir]); const preview = dryRunBoundedReplay(plan(file), config); const merge = vi.fn(() => ({ events: [], added: 0 }));
  expect(() => executeBoundedReplay(plan(file, false), config, preview.planDigest, { readCurrentConfig: () => { link(b, alias); return config; }, mergeEvents: merge })).toThrow("became stale"); expect(merge).not.toHaveBeenCalled();
  const after = dryRunBoundedReplay(plan(file), config); expect(after.wouldAdmit).toBe(preview.wouldAdmit); expect(after.planDigest).not.toBe(preview.planDigest);
});

it("same count and IDs but enrichment payload drift invalidates final confirmation", () => {
  const dir = fixture(); const file = join(dir, "source.jsonl"); writeFileSync(file, row(dir)); const config = cfg([dir]); let branch = "preview";
  vi.spyOn(git, "enrichEventsWithGit").mockImplementation((events) => events.map((entry) => ({ ...entry, gitBranch: branch })));
  const preview = dryRunBoundedReplay(plan(file), config); const merge = vi.fn(() => ({ events: [], added: 0 }));
  expect(() => executeBoundedReplay(plan(file, false), config, preview.planDigest, { readCurrentConfig: () => { branch = "execution"; return config; }, mergeEvents: merge })).toThrow("became stale"); expect(merge).not.toHaveBeenCalled();
  const after = dryRunBoundedReplay(plan(file), config); expect(after.wouldAdmit).toBe(preview.wouldAdmit); expect(after.planDigest).not.toBe(preview.planDigest);
});

it("ordinary missing descendants are admitted only under canonical existing allowed ancestors, with identity untouched", () => {
  const dir = fixture(); const allowed = join(dir, "allowed"); const denied = join(dir, "denied"); const alias = join(allowed, "alias"); mkdirSync(allowed); mkdirSync(denied); link(denied, alias); const config = cfg([allowed], [denied]);
  const accepted = event(join(allowed, "missing", "workspace"));
  expect(filterUsageEvents([accepted], config.privacy!)).toEqual([accepted]);
  expect(filterUsageEvents([event(join(alias, "missing", "workspace"))], config.privacy!)).toEqual([]);
});

it.each(["leaf", "descendant", "rule"])("broken symlink resolution fails closed at %s", (kind) => {
  const dir = fixture(); const alias = join(dir, "broken"); link(join(dir, "missing-target"), alias);
  const input = kind === "descendant" ? event(join(alias, "child")) : event(alias); const config = kind === "rule" ? cfg([alias]) : cfg([dir]);
  expect(filterUsageEvents([input], config.privacy!)).toEqual([]);
});

it("symlink cycle and ENOTDIR fail closed for event and scope roots", () => {
  const dir = fixture(); const cycle = join(dir, "cycle"); link(cycle, cycle); const regular = join(dir, "regular"); writeFileSync(regular, "not-directory");
  for (const path of [cycle, join(regular, "child")]) {
    expect(filterUsageEvents([event(path)], cfg([dir]).privacy!)).toEqual([]);
    expect(filterUsageEvents([event(dir)], cfg([path]).privacy!)).toEqual([]);
  }
});

it.skipIf(process.platform === "win32")("foreign Windows drive paths retain lexical bytes but dot traversal, sibling prefixes, and conflicting paths are denied", () => {
  const config = cfg(["C:\\ALLOWED"], ["C:\\denied"]);
  const input = event("c:/allowed/missing/project"); expect(filterUsageEvents([input], config.privacy!)).toEqual([input]);
  for (const path of ["C:\\allowed\\..\\denied", "c:/allowed/./project", "C:\\allowed-extra\\app", "C:\\denied\\app", "C:relative"]) expect(filterUsageEvents([event(path)], config.privacy!)).toEqual([]);
  expect(filterUsageEvents([{ ...input, localWorkspacePath: "C:\\denied" }], config.privacy!)).toEqual([]);
});

it.skipIf(process.platform === "win32")("foreign UNC policy is lexical, with case/separator boundaries and dot refusal; no native UNC claim", () => {
  const config = cfg(["\\\\fixture-host\\share\\allowed"], ["\\\\fixture-host\\share\\denied"]);
  const input = event("\\\\FIXTURE-HOST\\share\\allowed\\missing"); expect(filterUsageEvents([input], config.privacy!)).toEqual([input]);
  for (const path of ["\\\\fixture-host\\share\\allowed-extra", "\\\\fixture-host\\share\\allowed\\..\\denied", "\\\\fixture-host\\share\\denied\\app"]) expect(filterUsageEvents([event(path)], config.privacy!)).toEqual([]);
});
