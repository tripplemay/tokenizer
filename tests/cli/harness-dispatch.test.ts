import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanHarnessDispatchRuns } from "@/cli/harness-dispatch";

let repo: string;
let head: string;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function write(rel: string, content: string): string {
  const path = join(repo, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
  return path;
}

function meta(taskId: string, overrides: Record<string, unknown> = {}) {
  return {
    task_id: taskId,
    agent_id: "builder-codex",
    adapter: "codex",
    model_family: "untrusted-family",
    batch: "BL-TEST",
    ref: head,
    worktree: "/private/worktree/source",
    artifact: "artifact.json",
    log: "/private/logs/raw.log",
    endpoint: "https://private.example.test",
    outcome: "RETURNED",
    exit_code: 0,
    duration_s: 12,
    prompt: "never upload this",
    stderr: "never upload this either",
    ...overrides
  };
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "dispatch-summary-"));
  execFileSync("git", ["init", "-q", repo]);
  git(["config", "user.email", "agent@example.test"]);
  git(["config", "user.name", "Agent"]);
  write("tracked.txt", "tracked\n");
  git(["add", "tracked.txt"]);
  git(["commit", "-qm", "initial"]);
  head = git(["rev-parse", "HEAD"]);
  write(".agents-registry.json", JSON.stringify({
    agents: [
      {
        id: "builder-codex",
        roles: ["generator"],
        transport: "local-cli",
        model_family: "codex"
      },
      {
        id: "reviewer-kimi-a2a",
        roles: ["evaluator"],
        transport: "a2a",
        model_family: "kimi"
      }
    ]
  }));
  write("artifact.json", JSON.stringify({
    batch_id: "BL-TEST",
    created_at: "2026-07-27T12:00:00.000Z",
    waiting: null,
    features: [{ feature_id: "F004", files_touched: ["src/cli/harness.ts"] }]
  }));
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("dispatch run summary collection", () => {
  it("uses allowlisted facts, registry metadata, bounded time derivation, and safe artifact hashing", () => {
    const path = write(".harness-dispatch/run-meta-task-1.json", JSON.stringify(meta("task-1")));
    const finished = new Date("2026-07-27T12:00:12.000Z");
    utimesSync(path, finished, finished);
    const [run] = scanHarnessDispatchRuns(repo, new Set(["F004"]));

    expect(run).toMatchObject({
      runId: "task-1",
      taskId: "task-1",
      batch: "BL-TEST",
      feature: "F004",
      role: "generator",
      agentId: "builder-codex",
      modelFamily: "codex",
      transport: "local-cli",
      lockedSha: head,
      startedAt: "2026-07-27T12:00:00.000Z",
      finishedAt: "2026-07-27T12:00:12.000Z",
      durationMs: 12_000,
      outcome: "RETURNED",
      verdict: "COMPLETED",
      artifactPath: "artifact.json",
      artifactSha256: createHash("sha256").update(readFileSync(join(repo, "artifact.json"))).digest("hex"),
      errorSummary: null
    });
    const serialized = JSON.stringify(run);
    for (const forbidden of ["prompt", "stderr", "worktree", "endpoint", "/private/", "untrusted-family"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("supports a2a while reducing absolute artifacts and raw failures to safe fixed summaries", () => {
    write(".harness-dispatch/run-meta-task-a2a.json", JSON.stringify(meta("task-a2a", {
      agent_id: "reviewer-kimi-a2a",
      artifact: "/Users/alice/private/verdict.json",
      outcome: "FAILED",
      exit_code: 7,
      error: "Bearer secret and raw stderr"
    })));
    const [run] = scanHarnessDispatchRuns(repo, new Set(["F004"]));
    expect(run).toMatchObject({
      role: "evaluator",
      modelFamily: "kimi",
      transport: "a2a",
      outcome: "FAILED",
      exitCode: 7,
      verdict: null,
      artifactPath: "verdict.json",
      artifactSha256: null,
      errorSummary: "process_failed"
    });
    expect(JSON.stringify(run)).not.toContain("alice");
    expect(JSON.stringify(run)).not.toContain("Bearer");
  });

  it("keeps a2a cancellation as a known terminal outcome with a fixed safe summary", () => {
    write(".harness-dispatch/run-meta-task-canceled.json", JSON.stringify(meta("task-canceled", {
      agent_id: "reviewer-kimi-a2a",
      artifact: "",
      outcome: "CANCELED",
      exit_code: 0,
      termination_reason: "remote operator message and private diagnostics"
    })));

    const [run] = scanHarnessDispatchRuns(repo, new Set(["F004"]));
    expect(run).toMatchObject({
      role: "evaluator",
      transport: "a2a",
      outcome: "CANCELED",
      verdict: null,
      artifactPath: null,
      errorSummary: "canceled"
    });
    expect(JSON.stringify(run)).not.toContain("remote operator");
  });

  it("keeps runs of other batches (usage must survive batch switch) but rejects foreign refs", () => {
    write(".harness-dispatch/run-meta-other-batch.json", JSON.stringify(meta("other-batch", { batch: "BL-OTHER" })));
    write(".harness-dispatch/run-meta-wrong-ref.json", JSON.stringify(meta("wrong-ref", { ref: "f".repeat(40) })));
    write(".harness-dispatch/run-meta-short-ref.json", JSON.stringify(meta("short-ref", { ref: head.slice(0, 12) })));
    const runs = scanHarnessDispatchRuns(repo, new Set(["F004"]));
    expect(runs.map((run) => run.taskId)).toEqual(["other-batch"]);
    expect(runs[0].batch).toBe("BL-OTHER");
  });

  it("rejects symlinked run-meta and never hashes a symlinked artifact", () => {
    const outsideMeta = write("outside-meta.json", JSON.stringify(meta("symlinked-run")));
    mkdirSync(join(repo, ".harness-dispatch"), { recursive: true });
    symlinkSync(outsideMeta, join(repo, ".harness-dispatch", "run-meta-symlinked-run.json"));
    expect(scanHarnessDispatchRuns(repo, new Set(["F004"]))).toEqual([]);

    symlinkSync(join(repo, "artifact.json"), join(repo, "artifact-link.json"));
    write(
      ".harness-dispatch/run-meta-safe.json",
      JSON.stringify(meta("safe", { feature: "F004", artifact: "artifact-link.json" }))
    );
    const [run] = scanHarnessDispatchRuns(repo, new Set(["F004"]));
    expect(run).toMatchObject({
      taskId: "safe",
      artifactPath: "artifact-link.json",
      artifactSha256: null,
      feature: "F004"
    });
  });

  it("derives local-cli identities from a tool-integrations/1 registry (post-migration mirror survival)", () => {
    // 注册表 2026-08-05 迁到 tool-integrations/1 后，仅认 agents[] 的旧实现返回空表，
    // dispatch 镜像静默断链（BL-DISPATCH-USAGE-CAPTURE F004 实测撞出）——本用例钉死双格式解析。
    write(".agents-registry.json", JSON.stringify({
      version: "tool-integrations/1",
      integrations: [
        { id: "codex", tool: "codex", model_family: "codex", local_cli: { adapter: "codex" } }
      ]
    }));
    write(
      ".harness-dispatch/run-meta-integrations-run.json",
      JSON.stringify(meta("integrations-run", { agent_id: "local-cli--codex--generator" }))
    );
    const runs = scanHarnessDispatchRuns(repo, new Set(["F004"]));
    expect(runs.map((run) => run.taskId)).toContain("integrations-run");
    const run = runs.find((entry) => entry.taskId === "integrations-run");
    expect(run).toMatchObject({ agentId: "local-cli--codex--generator", modelFamily: "codex", transport: "local-cli" });
  });

  it("scans at most the newest 50 bounded regular JSON files", () => {
    for (let index = 0; index < 55; index += 1) {
      const path = write(
        `.harness-dispatch/run-meta-task-${String(index).padStart(2, "0")}.json`,
        JSON.stringify(meta(`task-${String(index).padStart(2, "0")}`, { outcome: "FAILED", artifact: "" }))
      );
      const time = new Date(1_700_000_000_000 + index * 1_000);
      utimesSync(path, time, time);
    }
    write(".harness-dispatch/run-meta-oversized.json", "x".repeat(64 * 1024 + 1));
    const runs = scanHarnessDispatchRuns(repo, new Set(["F004"]));
    expect(runs).toHaveLength(50);
    expect(runs[0].taskId).toBe("task-54");
    expect(runs.at(-1)?.taskId).toBe("task-05");
    expect(runs.every((run) => run.errorSummary === "process_failed")).toBe(true);
  });
});

// BL-DISPATCH-USAGE-CAPTURE F002 验收测试（evaluator 补写）：run-meta 可选 usage 块的
// 敌意解析——白名单/bounded/整块弃用语义；usage 是旁路不是闸门（无效 usage 不得吞掉 run）。
describe("run-meta usage uplink (F002)", () => {
  function usageBlock(overrides: Record<string, unknown> = {}) {
    return {
      model: null,
      input_tokens: 2_150_425,
      cached_input_tokens: 2_008_832,
      cache_write_tokens: 0,
      output_tokens: 19_667,
      reasoning_tokens: 7_702,
      turns: 1,
      extracted_from: "run-log",
      ...overrides
    };
  }

  it("carries a valid usage block and capture mode intact into the summary", () => {
    write(
      ".harness-dispatch/run-meta-with-usage.json",
      JSON.stringify(meta("with-usage", { usage: usageBlock({ model: "gpt-5-codex" }), usage_capture: "materialize" }))
    );
    const [run] = scanHarnessDispatchRuns(repo, new Set(["F004"]));
    expect(run.usage).toEqual({
      model: "gpt-5-codex",
      input_tokens: 2_150_425,
      cached_input_tokens: 2_008_832,
      cache_write_tokens: 0,
      output_tokens: 19_667,
      reasoning_tokens: 7_702,
      turns: 1,
      extracted_from: "run-log"
    });
    expect(run.usageCapture).toBe("materialize");
  });

  it("keeps legacy run-meta without usage summarized with explicit nulls (regression)", () => {
    write(".harness-dispatch/run-meta-legacy.json", JSON.stringify(meta("legacy")));
    const [run] = scanHarnessDispatchRuns(repo, new Set(["F004"]));
    expect(run.taskId).toBe("legacy");
    expect(run.usage).toBeNull();
    expect(run.usageCapture).toBeNull();
  });

  it.each([
    ["unknown field", usageBlock({ price_usd: 1 })],
    ["negative tokens", usageBlock({ input_tokens: -1 })],
    ["token count above the 2e9 bound", usageBlock({ input_tokens: 2_000_000_001 })],
    ["non-integer tokens", usageBlock({ output_tokens: 1.5 })],
    ["zero turns", usageBlock({ turns: 0 })],
    ["turns above the 10000 bound", usageBlock({ turns: 10_001 })],
    ["foreign extraction source", usageBlock({ extracted_from: "guess" })],
    ["missing extraction source", usageBlock({ extracted_from: undefined })],
    ["non-string model", usageBlock({ model: 42 })],
    ["oversized model name", usageBlock({ model: "x".repeat(129) })],
    ["array instead of object", [usageBlock()]],
    ["string instead of object", "9538301 tokens"]
  ])("drops the whole usage block on %s but keeps the run (bypass, not a gate)", (_label, usage) => {
    write(
      ".harness-dispatch/run-meta-hostile.json",
      JSON.stringify(meta("hostile", { usage, usage_capture: "materialize" }))
    );
    const [run] = scanHarnessDispatchRuns(repo, new Set(["F004"]));
    expect(run.taskId).toBe("hostile");
    expect(run.usage).toBeNull();
    expect(run.usageCapture).toBe("materialize");
  });

  it("nulls an unknown capture mode while keeping a valid usage block", () => {
    write(
      ".harness-dispatch/run-meta-bad-capture.json",
      JSON.stringify(meta("bad-capture", { usage: usageBlock(), usage_capture: "billing" }))
    );
    const [run] = scanHarnessDispatchRuns(repo, new Set(["F004"]));
    expect(run.usage).toMatchObject({ input_tokens: 2_150_425 });
    expect(run.usageCapture).toBeNull();
  });

  it("accepts attribution_only with a null usage block (kimi shape)", () => {
    write(
      ".harness-dispatch/run-meta-kimi-shape.json",
      JSON.stringify(meta("kimi-shape", { agent_id: "reviewer-kimi-a2a", usage: null, usage_capture: "attribution_only" }))
    );
    const [run] = scanHarnessDispatchRuns(repo, new Set(["F004"]));
    expect(run.usage).toBeNull();
    expect(run.usageCapture).toBe("attribution_only");
  });
});

