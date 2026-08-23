import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAUDE_PARSER_VERSION, parseClaudeUsage } from "@/parsers/claude";
import { emptyCursor } from "@/cli/cursor";

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

function rawAssistantRow(opts: {
  messageId: string;
  uuid: string;
  model?: string;
  timestamp?: string;
  usage?: Record<string, unknown>;
  content?: Array<Record<string, unknown>>;
}) {
  return {
    type: "assistant",
    uuid: opts.uuid,
    cwd: "/tmp/proj",
    timestamp: opts.timestamp ?? "2026-01-01T00:00:00.000Z",
    sessionId: "jsonl-session-stream",
    message: {
      role: "assistant",
      model: opts.model ?? "claude-3-5-sonnet",
      id: opts.messageId,
      ...(opts.content ? { content: opts.content } : {}),
      usage: opts.usage ?? {
        input_tokens: 0,
        output_tokens: 0,
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

  it("takes usage and model from the final row of a multi-row streamed message", () => {
    // Streaming writes several rows per message.id; early rows carry a
    // placeholder usage snapshot (tiny output_tokens), only the last row has
    // the real bill. Identity must still come from the first row so the
    // sourceEventId matches what earlier partial parses uploaded.
    writeJsonl("proj-stream", [
      rawAssistantRow({
        messageId: "msg-stream",
        uuid: "uuid-s1",
        timestamp: "2026-07-02T19:10:26.027Z",
        usage: { input_tokens: 2, output_tokens: 8, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
      }),
      rawAssistantRow({
        messageId: "msg-stream",
        uuid: "uuid-s2",
        timestamp: "2026-07-02T19:10:27.867Z",
        usage: { input_tokens: 2, output_tokens: 8, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
      }),
      rawAssistantRow({
        messageId: "msg-stream",
        uuid: "uuid-s3",
        timestamp: "2026-07-02T19:10:29.004Z",
        usage: { input_tokens: 2, output_tokens: 527, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 }
      })
    ]);
    const result = parseClaudeUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    expect(event.outputTokens).toBe(527);
    expect(event.inputTokens).toBe(2 + 500);
    expect(event.cachedInputTokens).toBe(500);
    expect(event.sourceEventId).toBe("claude-jsonl:msg-stream:uuid-s1");
    expect(event.occurredAt).toBe("2026-07-02T19:10:26.027Z");
    expect(event.fallbackFromModel ?? null).toBeNull();
    expect(event.fallbackToModel ?? null).toBeNull();
  });

  it("expands a mid-request model fallback into one event per billed iteration", () => {
    // Mirrors the real claude-fable-5 -> claude-opus-4-8 fallback sequence:
    // the message starts streaming on fable, a {type:"fallback"} block marks
    // the switch, and the final row's usage.iterations carries the per-model
    // bill. One event per iteration keeps model attribution and cost right.
    writeJsonl("proj-fallback", [
      rawAssistantRow({
        messageId: "msg-fb",
        uuid: "uuid-f1",
        model: "claude-fable-5",
        timestamp: "2026-07-02T19:14:20.691Z",
        usage: { input_tokens: 2, output_tokens: 8, cache_read_input_tokens: 71131, cache_creation_input_tokens: 2155 }
      }),
      rawAssistantRow({
        messageId: "msg-fb",
        uuid: "uuid-f2",
        model: "claude-fable-5",
        timestamp: "2026-07-02T19:14:23.552Z",
        usage: { input_tokens: 2, output_tokens: 8, cache_read_input_tokens: 71131, cache_creation_input_tokens: 2155 }
      }),
      rawAssistantRow({
        messageId: "msg-fb",
        uuid: "uuid-f3",
        model: "claude-opus-4-8",
        timestamp: "2026-07-02T19:14:23.681Z",
        content: [{ type: "fallback", from: { model: "claude-fable-5" }, to: { model: "claude-opus-4-8" } }],
        usage: { input_tokens: 2, output_tokens: 8, cache_read_input_tokens: 71131, cache_creation_input_tokens: 2155 }
      }),
      rawAssistantRow({
        messageId: "msg-fb",
        uuid: "uuid-f4",
        model: "claude-opus-4-8",
        timestamp: "2026-07-02T19:14:35.153Z",
        usage: {
          input_tokens: 2,
          output_tokens: 767,
          cache_read_input_tokens: 69459,
          cache_creation_input_tokens: 0,
          iterations: [
            {
              type: "message",
              model: "claude-fable-5",
              input_tokens: 2,
              output_tokens: 851,
              cache_read_input_tokens: 71131,
              cache_creation_input_tokens: 2155,
              cache_creation: { ephemeral_5m_input_tokens: 2155, ephemeral_1h_input_tokens: 0 }
            },
            {
              type: "fallback_message",
              model: "claude-opus-4-8",
              input_tokens: 2,
              output_tokens: 767,
              cache_read_input_tokens: 69459,
              cache_creation_input_tokens: 0
            }
          ]
        }
      })
    ]);

    const result = parseClaudeUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(2);

    const segment = result.events.find((e) => e.sourceEventId === "claude-jsonl:msg-fb:uuid-f1:iter0");
    expect(segment).toBeDefined();
    expect(segment!.model).toBe("claude-fable-5");
    expect(segment!.outputTokens).toBe(851);
    expect(segment!.inputTokens).toBe(2 + 2155 + 71131);
    expect(segment!.cachedInputTokens).toBe(71131);
    expect(segment!.cacheWriteTokens).toBe(2155);
    expect(segment!.fallbackToModel).toBe("claude-opus-4-8");
    expect(segment!.fallbackFromModel ?? null).toBeNull();
    expect(segment!.cacheEphemeral5mInputTokens).toBe(2155);
    expect(segment!.occurredAt).toBe("2026-07-02T19:14:20.691Z");

    const final = result.events.find((e) => e.sourceEventId === "claude-jsonl:msg-fb:uuid-f1");
    expect(final).toBeDefined();
    expect(final!.model).toBe("claude-opus-4-8");
    expect(final!.outputTokens).toBe(767);
    expect(final!.inputTokens).toBe(2 + 69459);
    expect(final!.fallbackFromModel).toBe("claude-fable-5");
    expect(final!.fallbackToModel ?? null).toBeNull();
    expect(final!.occurredAt).toBe("2026-07-02T19:14:20.691Z");
  });

  it("keeps the primary sourceEventId stable when a message completes in a later parse", () => {
    // A sync can race a message mid-stream: the first parse sees only the
    // fable rows, a later parse sees the full sequence. The primary event's
    // sourceEventId must not change so the server can correct the row in place.
    const partial = [
      rawAssistantRow({
        messageId: "msg-race",
        uuid: "uuid-r1",
        model: "claude-fable-5",
        usage: { input_tokens: 2, output_tokens: 8, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
      })
    ];
    const full = [
      ...partial,
      rawAssistantRow({
        messageId: "msg-race",
        uuid: "uuid-r2",
        model: "claude-opus-4-8",
        usage: {
          input_tokens: 2,
          output_tokens: 300,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          iterations: [
            { type: "message", model: "claude-fable-5", input_tokens: 2, output_tokens: 90 },
            { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 2, output_tokens: 300 }
          ]
        }
      })
    ];

    writeJsonl("proj-race", partial);
    const first = parseClaudeUsage({ homeDir, projectRoots: [] });
    expect(first.events).toHaveLength(1);
    const firstId = first.events[0].sourceEventId;
    expect(first.events[0].model).toBe("claude-fable-5");

    writeJsonl("proj-race", full);
    const second = parseClaudeUsage({ homeDir, projectRoots: [] });
    const finalEvent = second.events.find((e) => e.sourceEventId === firstId);
    expect(finalEvent).toBeDefined();
    expect(finalEvent!.model).toBe("claude-opus-4-8");
    expect(finalEvent!.outputTokens).toBe(300);
    expect(finalEvent!.fallbackFromModel).toBe("claude-fable-5");
  });

  it("marks fallbackFromModel from the fallback block when usage.iterations is absent", () => {
    writeJsonl("proj-block-only", [
      rawAssistantRow({
        messageId: "msg-blk",
        uuid: "uuid-b1",
        model: "claude-fable-5",
        usage: { input_tokens: 5, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
      }),
      rawAssistantRow({
        messageId: "msg-blk",
        uuid: "uuid-b2",
        model: "claude-opus-4-8",
        content: [{ type: "fallback", from: { model: "claude-fable-5" }, to: { model: "claude-opus-4-8" } }],
        usage: { input_tokens: 5, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
      })
    ]);
    const result = parseClaudeUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].model).toBe("claude-opus-4-8");
    expect(result.events[0].outputTokens).toBe(120);
    expect(result.events[0].fallbackFromModel).toBe("claude-fable-5");
  });

  it("warns when the final row's usage disagrees with the last iteration", () => {
    // Canary for the double-count-safety assumption: the final event bills
    // the top-level usage, the segments bill iterations[0..n-2]. That is only
    // safe while Anthropic keeps top-level usage == last iteration (not a
    // cumulative sum). If the shape ever changes, surface it loudly.
    writeJsonl("proj-canary", [
      rawAssistantRow({
        messageId: "msg-canary",
        uuid: "uuid-c1",
        usage: {
          input_tokens: 10,
          output_tokens: 500,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          iterations: [
            { type: "message", model: "claude-fable-5", input_tokens: 10, output_tokens: 200 },
            { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 10, output_tokens: 300 }
          ]
        }
      })
    ]);
    const result = parseClaudeUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(2);
    expect(result.warnings.some((w) => /disagrees with its last usage iteration/.test(w))).toBe(true);
  });

  it("warns when assistant rows lack message.id and falls back to per-line grouping", () => {
    const row = rawAssistantRow({
      messageId: "ignored",
      uuid: "uuid-noid",
      usage: { input_tokens: 5, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    }) as { message: { id?: string } };
    delete row.message.id;
    writeJsonl("proj-noid", [row as Record<string, unknown>]);
    const result = parseClaudeUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(1);
    expect(result.warnings.some((w) => /lack message\.id/.test(w))).toBe(true);
  });

  it("re-parses fingerprinted claude files once when the parser version bumps", () => {
    // v2 changed which streamed row a message's usage comes from (undercount
    // fix + fallback expansion). Files fingerprinted by an older parser
    // generation must be re-parsed once so the server can correct rows in
    // place; after that the normal fingerprint skip applies again.
    writeJsonl("proj-ver", [assistantJsonlRow("msg-v1", "uuid-v1", { input: 10, output: 5 })]);
    const cursor = emptyCursor();

    const first = parseClaudeUsage({ homeDir, projectRoots: [], cursor });
    expect(first.events).toHaveLength(1);
    expect(cursor.claudeParserVersion).toBe(CLAUDE_PARSER_VERSION);

    const second = parseClaudeUsage({ homeDir, projectRoots: [], cursor });
    expect(second.events).toHaveLength(0);

    cursor.claudeParserVersion = CLAUDE_PARSER_VERSION - 1;
    const third = parseClaudeUsage({ homeDir, projectRoots: [], cursor });
    expect(third.events).toHaveLength(1);
    expect(cursor.claudeParserVersion).toBe(CLAUDE_PARSER_VERSION);
  });

  it("re-emits only a message whose streamed rows continue after the cursor", () => {
    const file = writeJsonl("proj-append", [
      assistantJsonlRow("msg-stable", "uuid-stable", { input: 10, output: 5 }),
      assistantJsonlRow("msg-growing", "uuid-growing-first", { input: 20, output: 6 })
    ]);
    const cursor = emptyCursor();
    const first = parseClaudeUsage({ homeDir, projectRoots: [], cursor });

    appendFileSync(
      file,
      `${JSON.stringify(assistantJsonlRow("msg-growing", "uuid-growing-last", { input: 20, output: 30 }))}\n`
    );
    const second = parseClaudeUsage({ homeDir, projectRoots: [], cursor });

    expect(first.events).toHaveLength(2);
    expect(second.events).toHaveLength(1);
    expect(second.events[0]).toMatchObject({
      sourceEventId: "claude-jsonl:msg-growing:uuid-growing-first",
      inputTokens: 20,
      outputTokens: 30
    });
  });

  it("expands same-model iterations without fallback markers", () => {
    // Defensive: a mid-stream retry that did not switch models still bills
    // per iteration, but it is not a fallback and must not be flagged as one.
    writeJsonl("proj-retry", [
      rawAssistantRow({
        messageId: "msg-retry",
        uuid: "uuid-t1",
        usage: {
          input_tokens: 10,
          output_tokens: 40,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          iterations: [
            { type: "message", model: "claude-3-5-sonnet", input_tokens: 10, output_tokens: 25 },
            { type: "message", model: "claude-3-5-sonnet", input_tokens: 10, output_tokens: 40 }
          ]
        }
      })
    ]);
    const result = parseClaudeUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(2);
    for (const event of result.events) {
      expect(event.model).toBe("claude-3-5-sonnet");
      expect(event.fallbackFromModel ?? null).toBeNull();
      expect(event.fallbackToModel ?? null).toBeNull();
    }
  });
});
