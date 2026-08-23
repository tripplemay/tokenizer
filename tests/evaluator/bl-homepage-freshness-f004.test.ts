import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  appendStartOffset,
  emptyCursor,
  recordFile,
  shouldSkipAppendOnlyFile
} from "@/cli/cursor";
import { parseClaudeUsage } from "@/parsers/claude";
import { parseCodexUsage } from "@/parsers/codex";
import { readJsonlFile } from "@/parsers/jsonl";
import { parseKimiCodeUsage } from "@/parsers/kimicode";
import { parseOpenCodeUsage } from "@/parsers/opencode";

let homeDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "bl-homepage-f004-evaluator-"));
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
});

function writeJsonl(path: string, rows: unknown[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

function kimiRow(input: number, output: number, time: number, extra: Record<string, unknown> = {}) {
  return {
    type: "usage.record",
    model: "kimi-code/k3",
    usage: { inputOther: input, output },
    usageScope: "turn",
    time,
    ...extra
  };
}

function kimiWire(): string {
  const path = join(homeDir, ".kimi-code", "sessions", "workspace", "session", "agents", "main", "wire.jsonl");
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

function codexTokenCount(input: number, output: number, timestamp: string) {
  return {
    type: "event_msg",
    timestamp,
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: input,
          cached_input_tokens: 0,
          output_tokens: output,
          total_tokens: input + output
        },
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: 0,
          output_tokens: output,
          total_tokens: input + output
        }
      }
    }
  };
}

function claudeRow(messageId: string, uuid: string, output: number) {
  return {
    type: "assistant",
    uuid,
    cwd: "/tmp/evaluator-project",
    timestamp: "2026-08-23T00:00:00.000Z",
    sessionId: "claude-session",
    message: {
      role: "assistant",
      id: messageId,
      model: "claude-sonnet",
      usage: {
        input_tokens: 40,
        output_tokens: output,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0
      }
    }
  };
}

function createOpenCodeDb(): { dbPath: string; insert: (id: string, timeCreated: number) => void } {
  const dbPath = join(homeDir, ".local", "share", "opencode", "opencode.db");
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      directory TEXT,
      path TEXT,
      project_id TEXT,
      agent TEXT,
      model TEXT
    );
    CREATE TABLE project (
      id TEXT PRIMARY KEY,
      name TEXT,
      worktree TEXT
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      time_created INTEGER,
      time_updated INTEGER,
      data TEXT
    );
  `);
  db.prepare("INSERT INTO session (id, directory) VALUES (?, ?)").run("session", "/tmp/evaluator-project");
  db.close();

  return {
    dbPath,
    insert(id: string, timeCreated: number) {
      const writer = new Database(dbPath);
      writer.prepare(
        "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)"
      ).run(
        id,
        "session",
        timeCreated,
        timeCreated,
        JSON.stringify({
          role: "assistant",
          modelID: "gpt-5",
          tokens: {
            input: 10,
            output: 3,
            reasoning: 1,
            cache: { read: 2, write: 1 },
            total: 16
          },
          time: { completed: timeCreated }
        })
      );
      writer.close();
    }
  };
}

describe("BL-HOMEPAGE-FRESHNESS F004 evaluator probes", () => {
  it("reports UTF-8 byte offsets instead of UTF-16 string positions", () => {
    const file = join(homeDir, "utf8.jsonl");
    const first = JSON.stringify({ label: "项目" });
    const second = JSON.stringify({ label: "追加" });
    writeFileSync(file, `${first}\r\n${second}\n`);

    const parsed = readJsonlFile(file);

    expect(parsed.lines).toEqual([
      { text: first, lineNumber: 1, endOffset: Buffer.byteLength(`${first}\r\n`) },
      { text: second, lineNumber: 2, endOffset: Buffer.byteLength(`${first}\r\n${second}\n`) }
    ]);
    expect(parsed.byteLength).toBe(Buffer.byteLength(`${first}\r\n${second}\n`));
  });

  it("skips an append-only file after an mtime-only touch and replays after shrink", () => {
    const file = join(homeDir, "cursor.jsonl");
    writeFileSync(file, `${JSON.stringify({ long: "历史记录-abcdef" })}\n`);
    const cursor = emptyCursor();
    recordFile(file, cursor);
    const recordedSize = statSync(file).size;

    const future = new Date(Date.now() + 120_000);
    utimesSync(file, future, future);
    expect(shouldSkipAppendOnlyFile(file, cursor)).toBe(true);

    writeFileSync(file, "{}\n");
    expect(statSync(file).size).toBeLessThan(recordedSize);
    expect(shouldSkipAppendOnlyFile(file, cursor)).toBe(false);
    expect(appendStartOffset(file, cursor)).toBe(0);
  });

  it("retries an incomplete UTF-8 final row after the next append", () => {
    const file = kimiWire();
    const complete = `${JSON.stringify(kimiRow(11, 2, 1784269906213, { note: "项目" }))}\n`;
    const pending = JSON.stringify(kimiRow(29, 7, 1784269906214, { note: "未完成" }));
    const splitAt = pending.lastIndexOf("}");
    writeFileSync(file, complete + pending.slice(0, splitAt));
    const cursor = emptyCursor();

    const first = parseKimiCodeUsage({ homeDir, projectRoots: [], cursor });
    const recordedPartialSize = statSync(file).size;
    expect(first.events.map((event) => event.inputTokens)).toEqual([11]);
    expect(first.warnings).toHaveLength(1);
    expect(Object.values(cursor.files)[0].size).toBe(recordedPartialSize);

    appendFileSync(file, `${pending.slice(splitAt)}\n`);
    const second = parseKimiCodeUsage({ homeDir, projectRoots: [], cursor });
    expect(second.warnings).toEqual([]);
    expect(second.events).toHaveLength(1);
    expect(second.events[0]).toMatchObject({ inputTokens: 29, outputTokens: 7 });
  });

  it("replays Kimi from byte zero when a previously parsed wire shrinks", () => {
    const file = kimiWire();
    writeJsonl(file, [kimiRow(80, 8, 1784269906213), kimiRow(90, 9, 1784269906214)]);
    const cursor = emptyCursor();
    expect(parseKimiCodeUsage({ homeDir, projectRoots: [], cursor }).events).toHaveLength(2);

    writeJsonl(file, [kimiRow(3, 1, 1784269906215)]);
    const replay = parseKimiCodeUsage({ homeDir, projectRoots: [], cursor });
    expect(replay.events).toHaveLength(1);
    expect(replay.events[0]).toMatchObject({ inputTokens: 3, outputTokens: 1 });
  });

  it("uses the Codex prefix to calculate only the appended cumulative delta", () => {
    const file = join(homeDir, ".codex", "sessions", "rollout.jsonl");
    writeJsonl(file, [
      {
        type: "session_meta",
        timestamp: "2026-08-23T00:00:00.000Z",
        payload: { id: "codex-session", cwd: "/tmp/evaluator-project", model: "gpt-5" }
      },
      codexTokenCount(100, 20, "2026-08-23T00:00:01.000Z"),
      codexTokenCount(145, 25, "2026-08-23T00:00:02.000Z")
    ]);
    const cursor = emptyCursor();
    expect(parseCodexUsage({ homeDir, projectRoots: [], cursor }).events.map((event) => event.totalTokens)).toEqual([120, 50]);

    appendFileSync(file, `${JSON.stringify(codexTokenCount(190, 32, "2026-08-23T00:00:03.000Z"))}\n`);
    const appended = parseCodexUsage({ homeDir, projectRoots: [], cursor });
    expect(appended.events).toHaveLength(1);
    expect(appended.events[0]).toMatchObject({ inputTokens: 45, outputTokens: 7, totalTokens: 52 });
  });

  it("re-emits a Claude streamed continuation under its original canonical id", () => {
    const file = join(homeDir, ".claude", "projects", "project", "session.jsonl");
    writeJsonl(file, [
      claudeRow("stable", "stable-first", 5),
      claudeRow("continued", "continued-first", 4)
    ]);
    const cursor = emptyCursor();
    const initial = parseClaudeUsage({ homeDir, projectRoots: [], cursor });
    const original = initial.events.find((event) => event.sourceEventId.includes("continued"));
    expect(original).toMatchObject({ outputTokens: 4 });

    appendFileSync(file, `${JSON.stringify(claudeRow("continued", "continued-final", 37))}\n`);
    const continuation = parseClaudeUsage({ homeDir, projectRoots: [], cursor });
    expect(continuation.events).toHaveLength(1);
    expect(continuation.events[0]).toMatchObject({
      sourceEventId: original?.sourceEventId,
      outputTokens: 37
    });
  });

  it("emits only newly appended Kimi usage rows on consecutive scans", () => {
    const file = kimiWire();
    writeJsonl(file, [kimiRow(10, 2, 1784269906213), kimiRow(20, 3, 1784269906214)]);
    const cursor = emptyCursor();
    expect(parseKimiCodeUsage({ homeDir, projectRoots: [], cursor }).events.map((event) => event.inputTokens)).toEqual([10, 20]);

    appendFileSync(file, `${JSON.stringify(kimiRow(30, 4, 1784269906215))}\n`);
    expect(parseKimiCodeUsage({ homeDir, projectRoots: [], cursor }).events.map((event) => event.inputTokens)).toEqual([30]);
    expect(parseKimiCodeUsage({ homeDir, projectRoots: [], cursor }).events).toEqual([]);
  });

  it("preserves the OpenCode SQLite high-water cursor behavior", () => {
    const fixture = createOpenCodeDb();
    fixture.insert("old-1", 1_700_000_000_000);
    fixture.insert("old-2", 1_700_000_001_000);
    const cursor = emptyCursor();

    const initial = parseOpenCodeUsage({ homeDir, projectRoots: [], cursor });
    expect(initial.events.map((event) => event.sourceEventId)).toEqual(["opencode:old-1", "opencode:old-2"]);
    expect(cursor.opencodeLastTimeCreated).toBe(1_700_000_001_000);

    fixture.insert("new-1", 1_700_000_002_000);
    const appended = parseOpenCodeUsage({ homeDir, projectRoots: [], cursor });
    expect(appended.events.map((event) => event.sourceEventId)).toEqual(["opencode:new-1"]);
    expect(cursor.opencodeLastTimeCreated).toBe(1_700_000_002_000);
    expect(parseOpenCodeUsage({ homeDir, projectRoots: [], cursor }).events).toEqual([]);
  });
});
