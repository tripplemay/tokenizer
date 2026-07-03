import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAiderTokensLine, parseAiderUsage } from "@/parsers/aider";

describe("parseAiderTokensLine", () => {
  it("returns null for non-token lines", () => {
    expect(parseAiderTokensLine("> /add foo.py")).toBe(null);
    expect(parseAiderTokensLine("Added foo.py to the chat.")).toBe(null);
    expect(parseAiderTokensLine("")).toBe(null);
  });

  it("parses a minimal sent / received line", () => {
    const parsed = parseAiderTokensLine("Tokens: 1,234 sent, 89 received.");
    expect(parsed).toEqual({ sent: 1234, received: 89, cacheHit: 0, cacheWrite: 0, cost: null });
  });

  it("parses k-suffix values", () => {
    const parsed = parseAiderTokensLine("Tokens: 2.5k sent, 145 received.");
    expect(parsed).toEqual({ sent: 2500, received: 145, cacheHit: 0, cacheWrite: 0, cost: null });
  });

  it("parses the cache-hit variant introduced in Aider 0.46+", () => {
    const parsed = parseAiderTokensLine("Tokens: 5,049 sent, 800 cache hit, 145 received. Cost: $0.07 message, $0.07 session.");
    expect(parsed).toEqual({ sent: 5049, received: 145, cacheHit: 800, cacheWrite: 0, cost: 0.07 });
  });

  it("captures cache writes when reported", () => {
    const parsed = parseAiderTokensLine("Tokens: 1,000 sent, 200 cache write, 300 cache hit, 50 received.");
    expect(parsed).toEqual({ sent: 1000, received: 50, cacheHit: 300, cacheWrite: 200, cost: null });
  });
});

describe("parseAiderUsage (filesystem)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tk-aider-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("emits one event per Tokens: line, threading session timestamp + model state", () => {
    const projectDir = join(dir, "demo-project");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, ".aider.chat.history.md"),
      [
        "# aider chat started at 2026-05-17 10:00:00",
        "# Using model: claude-sonnet-4-6",
        "",
        "> /add foo.py",
        "",
        "Added foo.py to the chat.",
        "",
        "> change this function",
        "",
        "[assistant response]",
        "",
        "Tokens: 1,234 sent, 56 cache hit, 89 received. Cost: $0.0123 message, $0.0123 session.",
        "",
        "> another question",
        "",
        "Tokens: 2.5k sent, 145 received."
      ].join("\n")
    );

    const result = parseAiderUsage({ homeDir: tmpdir(), projectRoots: [dir] });
    expect(result.warnings).toEqual([]);
    expect(result.events).toHaveLength(2);

    const [first, second] = result.events;
    expect(first.source).toBe("aider");
    expect(first.model).toBe("claude-sonnet-4-6");
    expect(first.outputTokens).toBe(89);
    expect(first.cachedInputTokens).toBe(56);
    expect(first.inputTokens).toBeGreaterThanOrEqual(56);
    expect(first.costUsd).toBeCloseTo(0.0123, 4);
    expect(first.occurredAt).toBe(new Date("2026-05-17 10:00:00").toISOString());
    expect(first.workspacePath).toBe(projectDir);

    expect(second.outputTokens).toBe(145);
    expect(second.cachedInputTokens).toBe(0);
    expect(second.costUsd).toBe(null);

    // Each event needs a stable distinct id so server-side dedupe works.
    expect(new Set(result.events.map((e) => e.sourceEventId)).size).toBe(2);
  });

  it("skips files unchanged since the cursor was recorded", () => {
    const projectDir = join(dir, "demo");
    mkdirSync(projectDir, { recursive: true });
    const file = join(projectDir, ".aider.chat.history.md");
    writeFileSync(file, "# aider chat started at 2026-05-17 10:00:00\nTokens: 100 sent, 50 received.\n");

    const cursor = { files: {}, opencodeLastTimeCreated: 0, claudeParserVersion: 0 };
    const first = parseAiderUsage({ homeDir: tmpdir(), projectRoots: [dir], cursor });
    expect(first.events).toHaveLength(1);

    // Second pass with same cursor: file fingerprint matches, no events emitted.
    const second = parseAiderUsage({ homeDir: tmpdir(), projectRoots: [dir], cursor });
    expect(second.events).toHaveLength(0);
  });

  it("warns when projectRoots resolves to nothing", () => {
    const result = parseAiderUsage({ homeDir: tmpdir(), projectRoots: ["/path/that/will/never/exist/here-xyz"] });
    expect(result.events).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
