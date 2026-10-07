import { describe, expect, it } from "vitest";
import { collectionScopeFingerprint } from "@/cli/privacy";
import { planBoundedReplay } from "@/cli/replay-contract";

const base = {
  source: "claude-code" as const,
  file: "/selected/session.jsonl",
  from: "2026-10-01T00:00:00.000Z",
  to: "2026-10-02T00:00:00.000Z",
  maxBytes: 1_000_000,
  maxEvents: 100
};

describe("B03 independent replay admission boundary", () => {
  it("accepts exact hard limits while freezing a one-file dry-run plan", () => {
    const plan = planBoundedReplay({
      ...base,
      to: "2026-11-01T00:00:00.000Z",
      maxBytes: 16 * 1024 * 1024,
      maxEvents: 5_000
    });
    expect(plan).toEqual(expect.objectContaining({ maxFiles: 1, dryRun: true }));
    expect(Object.isFrozen(plan)).toBe(true);
  });

  it("rejects one-unit range and budget overruns", () => {
    expect(() => planBoundedReplay({ ...base, to: "2026-11-01T00:00:00.001Z" })).toThrow("within 31 days");
    expect(() => planBoundedReplay({ ...base, maxBytes: 16 * 1024 * 1024 + 1 })).toThrow("byte/event limits");
    expect(() => planBoundedReplay({ ...base, maxEvents: 5_001 })).toThrow("byte/event limits");
  });

  it.each([
    { execute: true },
    { recursive: true },
    { maxFiles: 1 }
  ])("rejects CLI-only flags or caller-controlled widening: %j", (extra) => {
    expect(() => planBoundedReplay({ ...base, ...extra })).toThrow();
  });

  it("represents the separately confirmed operational phase without widening scope", () => {
    expect(planBoundedReplay({ ...base, dryRun: false })).toEqual({
      ...base,
      maxFiles: 1,
      dryRun: false
    });
  });

  it.each([
    { source: "all" },
    { source: "codex" },
    { file: "/" },
    { file: "/selected/*.jsonl" },
    { file: "relative.jsonl" },
    { from: "2026-10-01T08:00:00.000+08:00" }
  ])("rejects unsupported or broad replay scope: %j", (change) => {
    expect(() => planBoundedReplay({ ...base, ...change })).toThrow();
  });

  it("keeps the local collection label independent of upload mode and list order", () => {
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
