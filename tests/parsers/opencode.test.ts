import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openCodeDataDirs, parseOpenCodeUsage } from "@/parsers/opencode";

let homeDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "tokenizer-opencode-"));
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
});

type SeedMessage = {
  id: string;
  data: Record<string, unknown>;
  timeCreated?: number;
};

function setupOpenCodeDb(messages: SeedMessage[], sessionId = "sess-1") {
  const dir = join(homeDir, ".local", "share", "opencode");
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, "opencode.db");
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
  db.prepare("INSERT INTO session (id, directory, model) VALUES (?, ?, ?)").run(sessionId, "/tmp/proj", null);
  const insert = db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)");
  for (const m of messages) {
    const t = m.timeCreated ?? 1700000000000;
    insert.run(m.id, sessionId, t, t, JSON.stringify(m.data));
  }
  db.close();
}

const assistantMessage = (overrides: Record<string, unknown> = {}) => ({
  role: "assistant",
  modelID: "gpt-5",
  providerID: "openai",
  time: { created: 1700000001000, completed: 1700000002000 },
  tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 30, write: 0 }, total: 180 },
  ...overrides
});

describe("parseOpenCodeUsage", () => {
  it("inputTokens is raw input + cache write + cache read (new total-input semantic)", () => {
    setupOpenCodeDb([
      {
        id: "msg-1",
        data: assistantMessage({
          tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 30, write: 25 }, total: 205 }
        })
      }
    ]);
    const result = parseOpenCodeUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    // 100 raw + 25 cache write + 30 cache read = 155
    expect(event.inputTokens).toBe(155);
    expect(event.cachedInputTokens).toBe(30);
    expect(event.cacheWriteTokens).toBe(25);
    expect(event.outputTokens).toBe(50);
    expect(event.totalTokens).toBe(205);
  });

  it("inputTokens still includes cache reads when cache.write is zero", () => {
    setupOpenCodeDb([
      {
        id: "msg-2",
        data: assistantMessage({
          tokens: { input: 50, output: 20, reasoning: 0, cache: { read: 100, write: 0 }, total: 170 }
        })
      }
    ]);
    const result = parseOpenCodeUsage({ homeDir, projectRoots: [] });
    // 50 raw + 0 cache write + 100 cache read = 150
    expect(result.events[0].inputTokens).toBe(150);
    expect(result.events[0].cachedInputTokens).toBe(100);
    expect(result.events[0].cacheWriteTokens).toBe(0);
  });

  it("uses opencode:<message_id> as a stable sourceEventId", () => {
    setupOpenCodeDb([{ id: "msg-3", data: assistantMessage() }]);
    const result = parseOpenCodeUsage({ homeDir, projectRoots: [] });
    expect(result.events[0].sourceEventId).toBe("opencode:msg-3");
  });

  it("skips messages whose role is not assistant", () => {
    setupOpenCodeDb([
      { id: "msg-4", data: { role: "user", tokens: { total: 999, input: 999, output: 0, cache: { read: 0, write: 0 } } } },
      { id: "msg-5", data: assistantMessage() }
    ]);
    const result = parseOpenCodeUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].sourceEventId).toBe("opencode:msg-5");
  });

  it("skips assistant messages whose total token count is zero", () => {
    setupOpenCodeDb([
      {
        id: "msg-6",
        data: assistantMessage({
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 }, total: 0 }
        })
      }
    ]);
    const result = parseOpenCodeUsage({ homeDir, projectRoots: [] });
    expect(result.events).toEqual([]);
  });
});

describe("openCodeDataDirs", () => {
  const ORIGINAL = { xdg: process.env.XDG_DATA_HOME, local: process.env.LOCALAPPDATA };
  afterEach(() => {
    if (ORIGINAL.xdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = ORIGINAL.xdg;
    if (ORIGINAL.local === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = ORIGINAL.local;
  });

  it("always offers the XDG default, which is where opencode really stores data", () => {
    // opencode bundles an XDG lib with no win32 branch: it resolves to
    // XDG_DATA_HOME || $HOME/.local/share on every platform, Windows included.
    delete process.env.XDG_DATA_HOME;
    const dirs = openCodeDataDirs(join("HOME"), join("CWD"));
    expect(dirs).toContain(join("HOME", ".local", "share", "opencode"));
  });

  it("honours XDG_DATA_HOME when set", () => {
    process.env.XDG_DATA_HOME = join("XDG");
    expect(openCodeDataDirs(join("HOME"), join("CWD"))).toContain(join("XDG", "opencode"));
  });

  it("offers LOCALAPPDATA candidates when the variable is present", () => {
    // Defensive only: opencode does not use these today, but its bundled deps
    // contain env-paths-style logic that would land here if it ever switched.
    process.env.LOCALAPPDATA = join("LOCAL");
    const dirs = openCodeDataDirs(join("HOME"), join("CWD"));
    expect(dirs).toContain(join("LOCAL", "opencode"));
    expect(dirs).toContain(join("LOCAL", "opencode", "Data"));
  });

  it("omits LOCALAPPDATA candidates when the variable is absent", () => {
    delete process.env.LOCALAPPDATA;
    const dirs = openCodeDataDirs(join("HOME"), join("CWD"));
    expect(dirs.some((dir) => dir.includes("LOCAL"))).toBe(false);
  });

  it("returns no duplicates", () => {
    process.env.LOCALAPPDATA = join("LOCAL");
    const dirs = openCodeDataDirs(join("HOME"), join("CWD"));
    expect(new Set(dirs).size).toBe(dirs.length);
  });
});
