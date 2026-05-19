import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCodexUsage } from "@/parsers/codex";

let homeDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "tokenizer-codex-"));
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
});

function writeRollout(name: string, lines: unknown[]) {
  const dir = join(homeDir, ".codex", "sessions");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  return file;
}

const sessionMeta = () => ({
  type: "session_meta",
  timestamp: "2026-01-01T00:00:00.000Z",
  payload: { id: "sess-1", cwd: "/tmp/proj", model: "gpt-5" }
});

const turnContext = () => ({
  type: "turn_context",
  timestamp: "2026-01-01T00:00:01.000Z",
  payload: { session_id: "sess-1", cwd: "/tmp/proj", model: "gpt-5" }
});

const tokenCountInfoNull = () => ({
  type: "event_msg",
  timestamp: "2026-01-01T00:00:01.500Z",
  payload: { type: "token_count", info: null }
});

const tokenCountEvent = (lastUsage: Record<string, number>, timestamp = "2026-01-01T00:00:02.000Z") => ({
  type: "event_msg",
  timestamp,
  payload: {
    type: "token_count",
    info: {
      total_token_usage: lastUsage,
      last_token_usage: lastUsage
    }
  }
});

describe("parseCodexUsage", () => {
  it("skips token_count events whose info field is null", () => {
    writeRollout("rollout-1.jsonl", [sessionMeta(), turnContext(), tokenCountInfoNull()]);
    const result = parseCodexUsage({ homeDir, projectRoots: [] });
    expect(result.events).toEqual([]);
  });

  it("stores Codex input_tokens verbatim (already total: includes cached portion)", () => {
    writeRollout("rollout-1.jsonl", [
      sessionMeta(),
      turnContext(),
      tokenCountEvent({ input_tokens: 100, cached_input_tokens: 30, output_tokens: 20, reasoning_output_tokens: 5, total_tokens: 120 })
    ]);
    const result = parseCodexUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    // Codex input_tokens already follows the new convention: it includes the
    // cached subset. Store as-is; downstream code subtracts cached when it
    // needs the "fresh" portion.
    expect(event.inputTokens).toBe(100);
    expect(event.cachedInputTokens).toBe(30);
    expect(event.cacheWriteTokens).toBe(0);
    expect(event.outputTokens).toBe(20);
    expect(event.totalTokens).toBe(120);
    expect(event.reasoningOutputTokens).toBe(5);
  });

  it("captures workspacePath and model from turn_context", () => {
    writeRollout("rollout-1.jsonl", [
      sessionMeta(),
      turnContext(),
      tokenCountEvent({ input_tokens: 50, cached_input_tokens: 10, output_tokens: 5, total_tokens: 55 })
    ]);
    const result = parseCodexUsage({ homeDir, projectRoots: [] });
    expect(result.events[0].workspacePath).toBe("/tmp/proj");
    expect(result.events[0].model).toBe("gpt-5");
    expect(result.events[0].sessionId).toBe("sess-1");
  });

  it("emits one UsageEvent per token_count event because last_token_usage is per-turn delta", () => {
    writeRollout("rollout-1.jsonl", [
      sessionMeta(),
      turnContext(),
      tokenCountEvent({ input_tokens: 100, cached_input_tokens: 30, output_tokens: 20, total_tokens: 120 }, "2026-01-01T00:00:02.000Z"),
      tokenCountEvent({ input_tokens: 150, cached_input_tokens: 50, output_tokens: 25, total_tokens: 175 }, "2026-01-01T00:00:03.000Z")
    ]);
    const result = parseCodexUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(2);
    expect(result.events[0].totalTokens).toBe(120);
    expect(result.events[1].totalTokens).toBe(175);
  });

  it("does not emit events for response_item lines", () => {
    writeRollout("rollout-1.jsonl", [
      sessionMeta(),
      turnContext(),
      { type: "response_item", timestamp: "2026-01-01T00:00:02.000Z", payload: { type: "message", content: "hi" } }
    ]);
    const result = parseCodexUsage({ homeDir, projectRoots: [] });
    expect(result.events).toEqual([]);
  });

  it("collapses identical token_count events written on multiple lines to one event", () => {
    // Regression for the May-2026 overcount bug: Codex CLI sometimes writes
    // the same token_count payload multiple times in one rollout (identical
    // timestamp + identical usage numbers, on consecutive lines). The old
    // sourceEventId included the line index, so each duplicate copy slipped
    // past the server's unique constraint — HanteenWongdeMacBook-Air had a
    // single event repeated up to 7 times in production.
    const sameUsage = { input_tokens: 100, cached_input_tokens: 0, output_tokens: 20, total_tokens: 120 };
    writeRollout("rollout-dup.jsonl", [
      sessionMeta(),
      turnContext(),
      tokenCountEvent(sameUsage, "2026-01-01T00:00:02.000Z"),
      tokenCountEvent(sameUsage, "2026-01-01T00:00:02.000Z"),
      tokenCountEvent(sameUsage, "2026-01-01T00:00:02.000Z"),
    ]);
    const result = parseCodexUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].totalTokens).toBe(120);
  });

  it("keeps distinct token_count events that share a timestamp but differ in usage", () => {
    writeRollout("rollout-mixed.jsonl", [
      sessionMeta(),
      turnContext(),
      tokenCountEvent({ input_tokens: 100, cached_input_tokens: 0, output_tokens: 20, total_tokens: 120 }, "2026-01-01T00:00:02.000Z"),
      tokenCountEvent({ input_tokens: 150, cached_input_tokens: 0, output_tokens: 25, total_tokens: 175 }, "2026-01-01T00:00:02.000Z"),
    ]);
    const result = parseCodexUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(2);
  });

  it("produces a stable sourceEventId derived from file + line + timestamp", () => {
    writeRollout("rollout-1.jsonl", [
      sessionMeta(),
      turnContext(),
      tokenCountEvent({ input_tokens: 100, cached_input_tokens: 0, output_tokens: 20, total_tokens: 120 })
    ]);
    const first = parseCodexUsage({ homeDir, projectRoots: [] });
    const second = parseCodexUsage({ homeDir, projectRoots: [] });
    expect(second.events[0].sourceEventId).toBe(first.events[0].sourceEventId);
  });
});
