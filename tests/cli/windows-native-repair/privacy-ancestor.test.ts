import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectionAdmissionFingerprint, filterUsageEvents, type PrivacyConfig } from "@/cli/privacy";
import type { UsageEventInput } from "@/shared/usage";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, lstatSync: vi.fn(actual.lstatSync),
    realpathSync: Object.assign(vi.fn(actual.realpathSync), { native: vi.fn(actual.realpathSync.native) }) };
});

const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
let root: string;
let directory: string;
let regular: string;
const event = (workspacePath: string, localWorkspacePath?: string): UsageEventInput => ({
  source: "claude-code", sourceEventId: `immutable:${workspacePath}`, workspacePath, localWorkspacePath,
  occurredAt: "2026-10-08T00:00:00.000Z", rawJson: { synthetic: true }
});
const rules = (includePaths: string[] = [root], excludePaths: string[] = []): PrivacyConfig => ({
  mode: "sync", includePaths, excludePaths
});
const fsError = (code: string) => Object.assign(new Error(`synthetic native ${code}`), { code });

function nativeMissingRegularTail(path: string) {
  vi.mocked(realpathSync.native).mockImplementation(((value: string) => {
    if (value === path) throw fsError("ENOENT");
    return actual.realpathSync.native(value);
  }) as typeof realpathSync.native);
  vi.mocked(lstatSync).mockImplementation(((value: string) => {
    if (value === path) throw fsError("ENOENT");
    return actual.lstatSync(value);
  }) as typeof lstatSync);
}

describe("missing-tail privacy ancestor controls", () => {
  beforeEach(() => {
    vi.mocked(realpathSync.native).mockReset().mockImplementation(actual.realpathSync.native);
    vi.mocked(lstatSync).mockReset().mockImplementation(actual.lstatSync);
    root = actual.realpathSync.native(mkdtempSync(join(tmpdir(), "wnp-")));
    directory = join(root, "directory");
    regular = join(root, "regular");
    mkdirSync(directory);
    writeFileSync(regular, "synthetic regular ancestor");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("rejects the recorded Windows ENOENT/ENOENT/regular-realpath fallback for an event", () => {
    const path = join(regular, "child");
    nativeMissingRegularTail(path);
    const row = event(path), before = JSON.stringify(row);
    expect(filterUsageEvents([row], rules())).toEqual([]);
    expect(JSON.stringify(row)).toBe(before);
  });

  it.each(["include", "exclude"])("fails closed for an ENOENT tail in a %s rule", (kind) => {
    const path = join(regular, "child");
    nativeMissingRegularTail(path);
    expect(filterUsageEvents([event(directory)], kind === "include" ? rules([path]) : rules([root], [path]))).toEqual([]);
  });

  it("rejects a native regular-file descendant in either event path", () => {
    const invalid = join(regular, "missing", "child");
    expect(filterUsageEvents([event(invalid), event(directory, invalid)], rules())).toEqual([]);
  });

  it("retains ordinary missing directory tails in events and include/exclude rules", () => {
    const missing = join(directory, "missing"), path = join(missing, "child");
    const row = event(path), before = JSON.stringify(row);
    const included = filterUsageEvents([row], rules([missing]));
    expect(included).toEqual([row]);
    expect(included[0]).toBe(row);
    expect(JSON.stringify(row)).toBe(before);
    expect(filterUsageEvents([row], rules([directory], [missing]))).toEqual([]);
    expect(filterUsageEvents([event(directory)], rules([root], [missing]))).toHaveLength(1);
  });

  it("does not demand a directory for a directly resolved valid event or rule", () => {
    const row = event(regular);
    expect(filterUsageEvents([row], rules())).toEqual([row]);
    expect(filterUsageEvents([row], rules([regular]))).toEqual([row]);
    expect(filterUsageEvents([row], rules([root], [regular]))).toEqual([]);
  });

  it("preserves physical alias matching and admission fingerprint without rewriting identities", () => {
    const alias = join(root, "alias");
    symlinkSync(directory, alias, process.platform === "win32" ? "junction" : "dir");
    const physicalRow = event(join(directory, "missing", "child"));
    const aliasRow = { ...physicalRow, workspacePath: join(alias, "missing", "child") };
    const before = JSON.stringify(aliasRow);
    expect(filterUsageEvents([aliasRow], rules([directory]))).toEqual([aliasRow]);
    expect(filterUsageEvents([aliasRow], rules([root], [directory]))).toEqual([]);
    expect(collectionAdmissionFingerprint([aliasRow], rules([alias])))
      .toBe(collectionAdmissionFingerprint([physicalRow], rules([directory])));
    expect(JSON.stringify(aliasRow)).toBe(before);
  });

  it.each(["EACCES", "ELOOP"])("keeps %s resolution failures closed", (code) => {
    vi.mocked(realpathSync.native).mockImplementation(((value: string) => {
      if (value === directory) throw fsError(code);
      return actual.realpathSync.native(value);
    }) as typeof realpathSync.native);
    expect(filterUsageEvents([event(directory)], rules())).toEqual([]);
    expect(filterUsageEvents([event(regular)], rules([root], [directory]))).toEqual([]);
  });

  it("rejects an unresolved existing link instead of treating it as an ordinary missing tail", () => {
    const path = join(directory, "broken");
    vi.mocked(realpathSync.native).mockImplementation(((value: string) => {
      if (value === path) throw fsError("ENOENT");
      return actual.realpathSync.native(value);
    }) as typeof realpathSync.native);
    vi.mocked(lstatSync).mockImplementation(((value: string) => {
      if (value === path) return { isSymbolicLink: () => true, isDirectory: () => false };
      return actual.lstatSync(value);
    }) as typeof lstatSync);
    expect(filterUsageEvents([event(path)], rules())).toEqual([]);
  });
});
