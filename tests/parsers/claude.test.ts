import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseClaudeUsage } from "@/parsers/claude";

let homeDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "tokenizer-claude-"));
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
});

function writeLegacy(sessionId: string, body: Record<string, unknown>) {
  const dir = join(homeDir, ".claude", "usage-data", "session-meta");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${sessionId}.json`);
  writeFileSync(file, JSON.stringify({ session_id: sessionId, ...body }));
  return file;
}

function writeJsonl(projectName: string, lines: Array<Record<string, unknown>>) {
  const dir = join(homeDir, ".claude", "projects", projectName);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "session.jsonl");
  writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  return file;
}

function assistantJsonlRow(messageId: string, uuid: string, tokens: { input: number; output: number }) {
  return {
    type: "assistant",
    uuid,
    cwd: "/tmp/proj",
    timestamp: "2026-01-01T00:00:00.000Z",
    sessionId: "jsonl-session",
    message: {
      role: "assistant",
      model: "claude-3-5-sonnet",
      id: messageId,
      usage: {
        input_tokens: tokens.input,
        output_tokens: tokens.output,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0
      }
    }
  };
}

describe("parseClaudeUsage", () => {
  it("emits a stable sourceEventId across legacy file mtime/content changes", () => {
    const file = writeLegacy("sess-1", {
      cwd: "/tmp/proj",
      input_tokens: 100,
      output_tokens: 50,
      model: "claude-3-5-sonnet"
    });

    const first = parseClaudeUsage({ homeDir, projectRoots: [] });
    expect(first.events).toHaveLength(1);
    const firstId = first.events[0].sourceEventId;

    // Simulate Claude rewriting the session-meta file with grown cumulative tokens.
    writeFileSync(
      file,
      JSON.stringify({
        session_id: "sess-1",
        cwd: "/tmp/proj",
        input_tokens: 200,
        output_tokens: 100,
        model: "claude-3-5-sonnet"
      })
    );
    const futureMtime = new Date(Date.now() + 10_000);
    utimesSync(file, futureMtime, futureMtime);

    const second = parseClaudeUsage({ homeDir, projectRoots: [] });
    expect(second.events).toHaveLength(1);
    expect(second.events[0].sourceEventId).toBe(firstId);
  });

  it("skips legacy session-meta entirely when projects/jsonl directory exists", () => {
    writeLegacy("sess-1", {
      cwd: "/tmp/proj",
      input_tokens: 100,
      output_tokens: 50
    });
    writeJsonl("proj-A", [assistantJsonlRow("msg-001", "uuid-001", { input: 10, output: 5 })]);

    const result = parseClaudeUsage({ homeDir, projectRoots: [] });

    // The buggy implementation produces sourceEventId "claude:<sid>:<hash>" for legacy
    // and "claude-jsonl:<id>:<uuid>" for jsonl. After the fix, the former must not appear.
    expect(result.events.some((event) => /^claude:/.test(event.sourceEventId))).toBe(false);
    expect(result.events.some((event) => /^claude-legacy:/.test(event.sourceEventId))).toBe(false);
    expect(result.events.some((event) => /^claude-jsonl:/.test(event.sourceEventId))).toBe(true);
  });

  it("parses legacy session-meta when no projects/jsonl directory exists", () => {
    writeLegacy("sess-1", {
      cwd: "/tmp/proj",
      input_tokens: 100,
      output_tokens: 50,
      model: "claude-3-5-sonnet"
    });

    const result = parseClaudeUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].inputTokens).toBe(100);
    expect(result.events[0].outputTokens).toBe(50);
    expect(result.events[0].totalTokens).toBe(150);
    expect(result.events[0].model).toBe("claude-3-5-sonnet");
  });

  it("warns when neither directory exists and emits no events", () => {
    const result = parseClaudeUsage({ homeDir, projectRoots: [] });
    expect(result.events).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/Claude usage directories not found/);
  });

  it("parses jsonl events when only the projects directory exists", () => {
    writeJsonl("proj-A", [assistantJsonlRow("msg-001", "uuid-001", { input: 10, output: 5 })]);

    const result = parseClaudeUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].sourceEventId).toMatch(/^claude-jsonl:/);
    expect(result.events[0].inputTokens).toBe(10);
    expect(result.events[0].outputTokens).toBe(5);
  });
});
