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

function assistantJsonlRowWithExtras(messageId: string, uuid: string, extras: {
  cacheEphemeral5m?: number;
  cacheEphemeral1h?: number;
  webSearch?: number;
  webFetch?: number;
  serviceTier?: string;
}) {
  return {
    type: "assistant",
    uuid,
    cwd: "/tmp/proj",
    timestamp: "2026-01-01T00:00:00.000Z",
    sessionId: "jsonl-session-extras",
    message: {
      role: "assistant",
      model: "claude-3-5-sonnet",
      id: messageId,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 100,
        cache_creation: {
          ephemeral_5m_input_tokens: extras.cacheEphemeral5m ?? 0,
          ephemeral_1h_input_tokens: extras.cacheEphemeral1h ?? 0,
        },
        server_tool_use: {
          web_search_requests: extras.webSearch ?? 0,
          web_fetch_requests: extras.webFetch ?? 0,
        },
        ...(extras.serviceTier ? { service_tier: extras.serviceTier } : {}),
      },
    },
  };
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

  it("extracts ephemeral cache, web tool, and service_tier fields", () => {
    writeJsonl("proj-A", [
      assistantJsonlRowWithExtras("msg-100", "uuid-100", {
        cacheEphemeral5m: 100,
        cacheEphemeral1h: 50,
        webSearch: 2,
        webFetch: 1,
        serviceTier: "priority",
      }),
    ]);
    const result = parseClaudeUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    expect(event.cacheEphemeral5mInputTokens).toBe(100);
    expect(event.cacheEphemeral1hInputTokens).toBe(50);
    expect(event.webSearchRequests).toBe(2);
    expect(event.webFetchRequests).toBe(1);
    expect(event.serviceTier).toBe("priority");
  });

  it("defaults all enrichment fields when JSONL omits them (backward compat)", () => {
    writeJsonl("proj-B", [assistantJsonlRow("msg-200", "uuid-200", { input: 10, output: 5 })]);
    const result = parseClaudeUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    expect(event.cacheEphemeral5mInputTokens).toBe(0);
    expect(event.cacheEphemeral1hInputTokens).toBe(0);
    expect(event.webSearchRequests).toBe(0);
    expect(event.webFetchRequests).toBe(0);
    expect(event.serviceTier).toBeNull();
  });

  it("collapses jsonl lines sharing one message.id to a single event", () => {
    // Regression for the May-2026 overcount bug: Claude Code wrote the same
    // assistant message to JSONL on multiple lines (same message.id, different
    // per-line uuid). The old sourceEventId scheme included row.uuid so each
    // copy slipped past the server's unique constraint and over-counted usage.
    writeJsonl("proj-dup", [
      assistantJsonlRow("msg-shared", "uuid-1", { input: 100, output: 50 }),
      assistantJsonlRow("msg-shared", "uuid-2", { input: 100, output: 50 }),
      assistantJsonlRow("msg-shared", "uuid-3", { input: 100, output: 50 }),
    ]);
    const result = parseClaudeUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].inputTokens).toBe(100);
    expect(result.events[0].outputTokens).toBe(50);
  });

  it("keeps distinct message.ids even within a single file", () => {
    writeJsonl("proj-mix", [
      assistantJsonlRow("msg-a", "uuid-1", { input: 10, output: 5 }),
      assistantJsonlRow("msg-b", "uuid-2", { input: 20, output: 7 }),
      assistantJsonlRow("msg-a", "uuid-3", { input: 10, output: 5 }),
    ]);
    const result = parseClaudeUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(2);
    const ids = new Set(result.events.map((e) => e.sourceEventId));
    expect(ids.size).toBe(2);
  });

  it("preserves a non-standard service_tier value verbatim", () => {
    writeJsonl("proj-C", [
      assistantJsonlRowWithExtras("msg-300", "uuid-300", { serviceTier: "enterprise-beta" }),
    ]);
    const result = parseClaudeUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].serviceTier).toBe("enterprise-beta");
  });
});
