import { describe, expect, it } from "vitest";
import { planBoundedReplay } from "@/cli/replay-contract";
import { collectionScopeFingerprint } from "@/cli/privacy";

const base = {
  source: "claude-code" as const,
  file: "/selected/session.jsonl",
  from: "2026-10-01T00:00:00.000Z",
  to: "2026-10-02T00:00:00.000Z",
  maxBytes: 1_000_000,
  maxEvents: 100
};

describe("R07 operational replay contract", () => {
  it("preserves the exact one-file limits and dry-run default", () => {
    const planned = planBoundedReplay({
      ...base,
      to: "2026-11-01T00:00:00.000Z",
      maxBytes: 16 * 1024 * 1024,
      maxEvents: 5_000
    });
    expect(planned).toEqual(expect.objectContaining({ maxFiles: 1, dryRun: true }));
    expect(Object.isFrozen(planned)).toBe(true);
  });

  it("represents execution only through an explicit false dryRun phase", () => {
    expect(planBoundedReplay({ ...base, dryRun: false })).toEqual({
      ...base,
      maxFiles: 1,
      dryRun: false
    });
    expect(() => planBoundedReplay({ ...base, dryRun: "false" })).toThrow("dryRun must be boolean");
  });

  it("rejects one-unit range and budget overruns", () => {
    expect(() => planBoundedReplay({ ...base, to: "2026-11-01T00:00:00.001Z" })).toThrow("within 31 days");
    expect(() => planBoundedReplay({ ...base, maxBytes: 16 * 1024 * 1024 + 1 })).toThrow("byte/event limits");
    expect(() => planBoundedReplay({ ...base, maxEvents: 5_001 })).toThrow("byte/event limits");
  });

  it.each([
    { execute: true },
    { recursive: true },
    { maxFiles: 1 },
    { homeDir: "/" }
  ])("rejects CLI-only or caller-controlled widening: %j", (extra) => {
    expect(() => planBoundedReplay({ ...base, ...extra })).toThrow("Unknown replay");
  });

  it.each([
    { source: "all" },
    { source: "codex" },
    { file: "/" },
    { file: "/selected/*.jsonl" },
    { file: "relative.jsonl" },
    { from: "2026-10-01T08:00:00.000+08:00" }
  ])("retains the historical unsupported/broad scope negatives: %j", (change) => {
    expect(() => planBoundedReplay({ ...base, ...change })).toThrow();
  });

  it("keeps collection scope independent of upload mode and list order", () => {
    const local = collectionScopeFingerprint({
      mode: "local-only",
      includePaths: ["/work/b", "/work/a", "/work/a"],
      excludePaths: ["/work/private"]
    });
    const sync = collectionScopeFingerprint({
      mode: "sync",
      includePaths: ["/work/a", "/work/b"],
      excludePaths: ["/work/private"]
    });
    expect(local).toBe(sync);
    expect(local).toMatch(/^scope-v1:[0-9a-f]{64}$/);
  });
});
