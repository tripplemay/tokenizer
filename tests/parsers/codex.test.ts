import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCodexUsage } from "@/parsers/codex";
import { emptyCursor } from "@/cli/cursor";

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

  it("emits only the positive delta from cumulative total_token_usage", () => {
    writeRollout("rollout-1.jsonl", [
      sessionMeta(),
      turnContext(),
      tokenCountEvent({ input_tokens: 100, cached_input_tokens: 30, output_tokens: 20, total_tokens: 120 }, "2026-01-01T00:00:02.000Z"),
      tokenCountEvent({ input_tokens: 150, cached_input_tokens: 50, output_tokens: 25, total_tokens: 175 }, "2026-01-01T00:00:03.000Z")
    ]);
    const result = parseCodexUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(2);
    expect(result.events[0].totalTokens).toBe(120);
    expect(result.events[1]).toMatchObject({
      inputTokens: 50,
      cachedInputTokens: 20,
      outputTokens: 5,
      totalTokens: 55
    });
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

  it("collapses cumulative snapshots with the same total even when timestamps differ", () => {
    const sameUsage = { input_tokens: 100, cached_input_tokens: 0, output_tokens: 20, total_tokens: 120 };
    writeRollout("rollout-dup.jsonl", [
      sessionMeta(),
      turnContext(),
      tokenCountEvent(sameUsage, "2026-01-01T00:00:02.000Z"),
      tokenCountEvent(sameUsage, "2026-01-01T00:00:03.000Z"),
      tokenCountEvent(sameUsage, "2026-01-01T00:00:04.000Z"),
    ]);
    const result = parseCodexUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].totalTokens).toBe(120);
  });

  it("keeps distinct cumulative snapshots that share a timestamp but grow", () => {
    writeRollout("rollout-mixed.jsonl", [
      sessionMeta(),
      turnContext(),
      tokenCountEvent({ input_tokens: 100, cached_input_tokens: 0, output_tokens: 20, total_tokens: 120 }, "2026-01-01T00:00:02.000Z"),
      tokenCountEvent({ input_tokens: 150, cached_input_tokens: 0, output_tokens: 25, total_tokens: 175 }, "2026-01-01T00:00:02.000Z"),
    ]);
    const result = parseCodexUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(2);
  });

  it("uses a canonical sourceEventId independent of file, line, or timestamp", () => {
    writeRollout("rollout-1.jsonl", [
      sessionMeta(),
      turnContext(),
      tokenCountEvent({ input_tokens: 100, cached_input_tokens: 0, output_tokens: 20, total_tokens: 120 })
    ]);
    const first = parseCodexUsage({ homeDir, projectRoots: [] });
    const second = parseCodexUsage({ homeDir, projectRoots: [] });
    expect(first.events[0].sourceEventId).toBe("codex:v2:sess-1:100:0:0:20:0:120");
    expect(second.events[0].sourceEventId).toBe(first.events[0].sourceEventId);
  });

  it("captures cache_write_input_tokens in the canonical delta", () => {
    writeRollout("rollout-cache-write.jsonl", [
      sessionMeta(),
      turnContext(),
      tokenCountEvent({ input_tokens: 100, cached_input_tokens: 30, cache_write_input_tokens: 7, output_tokens: 20, total_tokens: 120 }),
      tokenCountEvent({ input_tokens: 150, cached_input_tokens: 50, cache_write_input_tokens: 9, output_tokens: 25, total_tokens: 175 }, "2026-01-01T00:00:03.000Z")
    ]);
    const result = parseCodexUsage({ homeDir, projectRoots: [] });
    expect(result.events[1]).toMatchObject({ cacheWriteTokens: 2, totalTokens: 55 });
    expect(result.events[1].sourceEventId).toBe("codex:v2:sess-1:150:50:9:25:0:175");
  });

  it("filters a replayed cumulative snapshot across rollout files", () => {
    writeRollout("a-rollout.jsonl", [
      sessionMeta(),
      turnContext(),
      tokenCountEvent({ input_tokens: 100, cached_input_tokens: 0, output_tokens: 20, total_tokens: 120 })
    ]);
    writeRollout("b-rollout.jsonl", [
      sessionMeta(),
      turnContext(),
      tokenCountEvent({ input_tokens: 100, cached_input_tokens: 0, output_tokens: 20, total_tokens: 120 }, "2026-01-01T00:01:02.000Z"),
      tokenCountEvent({ input_tokens: 150, cached_input_tokens: 0, output_tokens: 25, total_tokens: 175 }, "2026-01-01T00:01:03.000Z")
    ]);
    const result = parseCodexUsage({ homeDir, projectRoots: [] });
    expect(result.events.map((event) => event.totalTokens)).toEqual([120, 55]);
  });

  it("uses the old prefix for cumulative state but emits only a newly appended snapshot", () => {
    const file = writeRollout("rollout-cursor.jsonl", [
      sessionMeta(),
      turnContext(),
      tokenCountEvent({ input_tokens: 100, cached_input_tokens: 0, output_tokens: 20, total_tokens: 120 }),
      tokenCountEvent({ input_tokens: 150, cached_input_tokens: 0, output_tokens: 25, total_tokens: 175 }, "2026-01-01T00:00:03.000Z")
    ]);
    const cursor = emptyCursor();
    const first = parseCodexUsage({ homeDir, projectRoots: [], cursor });
    appendFileSync(file, `${JSON.stringify(tokenCountEvent({ input_tokens: 200, cached_input_tokens: 0, output_tokens: 30, total_tokens: 230 }, "2026-01-01T00:00:04.000Z"))}\n`);
    const second = parseCodexUsage({ homeDir, projectRoots: [], cursor });
    expect(first.events).toHaveLength(2);
    expect(second.events).toHaveLength(1);
    expect(second.events[0]).toMatchObject({
      sourceEventId: "codex:v2:sess-1:200:0:0:30:0:230",
      inputTokens: 50,
      outputTokens: 5,
      totalTokens: 55
    });
  });
});
