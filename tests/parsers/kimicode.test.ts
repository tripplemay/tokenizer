import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseKimiCodeUsage } from "@/parsers/kimicode";

let homeDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "tokenizer-kimicode-"));
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
});

// Write a Kimi Code session: <sessions>/<ws>/<session>/state.json (workDir) and
// one wire.jsonl per named agent.
function writeSession(opts: {
  workspaceId?: string;
  sessionId?: string;
  workDir?: string;
  agents: Record<string, unknown[]>;
}) {
  const workspaceId = opts.workspaceId ?? "wd_proj_abc";
  const sessionId = opts.sessionId ?? "session_1";
  const sessionDir = join(homeDir, ".kimi-code", "sessions", workspaceId, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  if (opts.workDir !== undefined) {
    writeFileSync(join(sessionDir, "state.json"), JSON.stringify({ workDir: opts.workDir }));
  }
  const files: Record<string, string> = {};
  for (const [agent, lines] of Object.entries(opts.agents)) {
    const agentDir = join(sessionDir, "agents", agent);
    mkdirSync(agentDir, { recursive: true });
    const file = join(agentDir, "wire.jsonl");
    writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
    files[agent] = file;
  }
  return { sessionDir, files };
}

const usageRecord = (
  usage: { inputOther?: number; inputCacheRead?: number; inputCacheCreation?: number; output?: number },
  extra: Record<string, unknown> = {}
) => ({
  type: "usage.record",
  model: "kimi-code/k3",
  usage,
  usageScope: "turn",
  time: 1784269906213,
  ...extra
});

describe("parseKimiCodeUsage", () => {
  it("maps inputOther+cache into inputTokens and keeps the cache buckets separate", () => {
    writeSession({ agents: { main: [usageRecord({ inputOther: 2743, inputCacheRead: 7680, inputCacheCreation: 100, output: 167 })] } });
    const result = parseKimiCodeUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    expect(event.source).toBe("kimicode");
    expect(event.model).toBe("kimi-code/k3");
    expect(event.cachedInputTokens).toBe(7680);
    expect(event.cacheWriteTokens).toBe(100);
    // inputTokens is the total input (fresh + cache read + cache write).
    expect(event.inputTokens).toBe(2743 + 7680 + 100);
    expect(event.outputTokens).toBe(167);
    expect(event.totalTokens).toBe(2743 + 7680 + 100 + 167);
  });

  it("converts the epoch-ms time into an ISO occurredAt", () => {
    writeSession({ agents: { main: [usageRecord({ inputOther: 10, output: 5 }, { time: 1784269906213 })] } });
    const result = parseKimiCodeUsage({ homeDir, projectRoots: [] });
    expect(result.events[0].occurredAt).toBe(new Date(1784269906213).toISOString());
  });

  it("ignores usage records that are not turn-scoped", () => {
    writeSession({
      agents: {
        main: [
          usageRecord({ inputOther: 10, output: 5 }, { usageScope: "session" }),
          usageRecord({ inputOther: 20, output: 6 })
        ]
      }
    });
    const result = parseKimiCodeUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].inputTokens).toBe(20);
  });

  it("ignores non usage.record wire events", () => {
    writeSession({
      agents: {
        main: [
          { type: "llm.request", provider: "kimi", model: "k3", time: 1784269891210 },
          { type: "metadata", protocol_version: "1.4" },
          usageRecord({ inputOther: 12, output: 3 })
        ]
      }
    });
    const result = parseKimiCodeUsage({ homeDir, projectRoots: [] });
    expect(result.events).toHaveLength(1);
  });

  it("skips records whose total tokens are zero", () => {
    writeSession({ agents: { main: [usageRecord({ inputOther: 0, inputCacheRead: 0, inputCacheCreation: 0, output: 0 })] } });
    const result = parseKimiCodeUsage({ homeDir, projectRoots: [] });
    expect(result.events).toEqual([]);
  });

  it("derives workspacePath/projectName from state.json workDir and collects every agent", () => {
    writeSession({
      workDir: "/Users/me/project/demo",
      agents: {
        main: [usageRecord({ inputOther: 10, output: 5 })],
        "agent-0": [usageRecord({ inputOther: 20, output: 6 })]
      }
    });
    const result = parseKimiCodeUsage({ homeDir, projectRoots: ["/Users/me/project"] });
    expect(result.events).toHaveLength(2);
    for (const event of result.events) {
      expect(event.workspacePath).toBe("/Users/me/project/demo");
      expect(event.projectName).toBe("demo");
      expect(event.sessionId).toBe("session_1");
    }
  });

  it("falls back to session_index.jsonl workDir when state.json is absent", () => {
    const { sessionDir } = writeSession({ agents: { main: [usageRecord({ inputOther: 10, output: 5 })] } });
    writeFileSync(
      join(homeDir, ".kimi-code", "session_index.jsonl"),
      JSON.stringify({ sessionId: "session_1", sessionDir, workDir: "/Users/me/project/demo" }) + "\n"
    );
    const result = parseKimiCodeUsage({ homeDir, projectRoots: ["/Users/me/project"] });
    expect(result.events[0].workspacePath).toBe("/Users/me/project/demo");
    expect(result.events[0].projectName).toBe("demo");
  });

  it("produces a stable sourceEventId across runs", () => {
    writeSession({ agents: { main: [usageRecord({ inputOther: 10, output: 5 })] } });
    const first = parseKimiCodeUsage({ homeDir, projectRoots: [] });
    const second = parseKimiCodeUsage({ homeDir, projectRoots: [] });
    expect(second.events[0].sourceEventId).toBe(first.events[0].sourceEventId);
    expect(first.events[0].sourceEventId).toContain("kimicode:");
  });

  it("warns when the Kimi Code sessions directory is absent", () => {
    const result = parseKimiCodeUsage({ homeDir, projectRoots: [] });
    expect(result.events).toEqual([]);
    expect(result.warnings[0]).toContain("Kimi Code sessions directory not found");
  });
});
