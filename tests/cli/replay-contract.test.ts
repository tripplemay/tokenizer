import { describe, expect, it } from "vitest";
import { planBoundedReplay } from "@/cli/replay-contract";

const request = {
  source: "claude-code",
  file: "/explicit/session.jsonl",
  from: "2026-10-01T00:00:00.000Z",
  to: "2026-10-02T00:00:00.000Z",
  maxBytes: 1_000_000,
  maxEvents: 100
};

describe("future bounded replay interface (non-executing contract only)", () => {
  it("defaults an explicit one-file UTC-budgeted request to a frozen dry-run plan", () => {
    const plan = planBoundedReplay(request);
    expect(plan).toEqual({ ...request, maxFiles: 1, dryRun: true });
    expect(Object.isFrozen(plan)).toBe(true);
  });

  it.each([undefined, "", "/", "/Users/example", "C:\\", "~/.claude", "relative.jsonl", "/logs/*.jsonl", "/logs/a?.jsonl", "/logs/[ab].jsonl"])("rejects missing/broad/directory/glob scope %s", (file) => {
    expect(() => planBoundedReplay({ ...request, file })).toThrow("one absolute literal");
  });

  it("accepts literal Windows file spelling without selecting a Windows home root", () => {
    expect(planBoundedReplay({ ...request, file: "C:\\selected\\session.jsonl" }).maxFiles).toBe(1);
  });

  it.each(["codex", "opencode", "kimicode", "aider", "all"])("refuses unsupported source %s rather than falling back to discovery", (source) => {
    expect(() => planBoundedReplay({ ...request, source })).toThrow("explicit-file adapter");
  });

  it("rejects unknown recursive or root scope options", () => {
    expect(() => planBoundedReplay({ ...request, recursive: true })).toThrow("Unknown replay");
    expect(() => planBoundedReplay({ ...request, homeDir: "/" })).toThrow("Unknown replay");
    expect(() => planBoundedReplay({ ...request, maxFiles: 2 })).toThrow("Unknown replay");
  });

  it.each([{}, { from: undefined }, { to: undefined }, { from: "2026-10-01T01:00:00+01:00" }, { to: request.from }, { to: "2027-10-02T00:00:00.000Z" }])("requires a bounded canonical UTC range %j", (range) => {
    const input = Object.keys(range).length ? { ...request, ...range } : { ...request, from: undefined, to: undefined };
    expect(() => planBoundedReplay(input)).toThrow("canonical UTC");
  });

  it.each([undefined, 0, -1, Infinity, 1.5, 16 * 1024 * 1024 + 1])("rejects an unbounded/invalid byte budget %s", (maxBytes) => {
    expect(() => planBoundedReplay({ ...request, maxBytes })).toThrow("byte/event limits");
  });

  it.each([undefined, 0, -1, Infinity, 1.5, 5001])("rejects an unbounded/invalid event budget %s", (maxEvents) => {
    expect(() => planBoundedReplay({ ...request, maxEvents })).toThrow("byte/event limits");
  });

  it("cannot execute or silently reinterpret a plan as collection", () => {
    expect(() => planBoundedReplay({ ...request, dryRun: false })).toThrow("execution is not implemented");
  });
});
