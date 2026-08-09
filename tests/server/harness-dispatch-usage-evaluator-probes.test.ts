// BL-DISPATCH-USAGE-CAPTURE F003 隔离验收探针（evaluator 独立构造，测试外解析边界）。
// 目的：验证 parseDispatchRuns 对 generator 测试未覆盖的敌意/畸形 usage 载荷 fail-closed。
import { describe, expect, it } from "vitest";

import { parseDispatchRuns } from "../../src/server/harness-mode-intent-api";

const HEAD = "0123456789abcdef0123456789abcdef01234567";

function usage(overrides: Record<string, unknown> = {}) {
  return {
    model: null,
    input_tokens: 1_000,
    cached_input_tokens: 0,
    cache_write_tokens: 0,
    output_tokens: 500,
    reasoning_tokens: 0,
    turns: 1,
    extracted_from: "run-log",
    ...overrides
  };
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    runId: "probe-run-1",
    taskId: "build-probe-20260810T000000Z",
    batch: "BL-PROBE",
    feature: null,
    role: "generator",
    agentId: "local-cli--codex--generator",
    modelFamily: "codex",
    transport: "local-cli",
    lockedSha: HEAD,
    startedAt: "2026-08-10T00:00:00.000Z",
    finishedAt: "2026-08-10T00:10:00.000Z",
    durationMs: 600_000,
    outcome: "RETURNED",
    ...overrides
  };
}

describe("evaluator probes: dispatch usage parse boundaries beyond generator tests", () => {
  it.each([
    ["usage block is an array", { usage: [usage()], usageCapture: "materialize" }],
    ["usage block is a string", { usage: "input 1000 output 500", usageCapture: "materialize" }],
    ["turns=0 (below minimum 1)", { usage: usage({ turns: 0 }), usageCapture: "materialize" }],
    ["turns above 10000 cap", { usage: usage({ turns: 10_001 }), usageCapture: "materialize" }],
    ["input_tokens above 2e9 cap", { usage: usage({ input_tokens: 2_000_000_001 }), usageCapture: "materialize" }],
    ["non-integer input_tokens", { usage: usage({ input_tokens: 1.5 }), usageCapture: "materialize" }],
    ["input_tokens as numeric string", { usage: usage({ input_tokens: "1000" }), usageCapture: "materialize" }],
    ["missing required reasoning_tokens", (() => {
      const u = usage() as Record<string, unknown>;
      delete u.reasoning_tokens;
      return { usage: u, usageCapture: "materialize" };
    })()],
    ["extracted_from case variant Run-Log", { usage: usage({ extracted_from: "Run-Log" }), usageCapture: "materialize" }],
    ["empty-string model", { usage: usage({ model: "" }), usageCapture: "materialize" }],
    ["usageCapture as array", { usage: usage(), usageCapture: ["materialize"] }]
  ])("rejects %s", (_label, overrides) => {
    expect(() => parseDispatchRuns([run(overrides as Record<string, unknown>)])).toThrowError();
  });

  it("accepts the exact 2e9 token boundary", () => {
    const [parsed] = parseDispatchRuns([
      run({ usage: usage({ input_tokens: 2_000_000_000 }), usageCapture: "materialize" })
    ]);
    expect(parsed.usageInputTokens).toBe(2_000_000_000);
  });

  it("allows a standalone usageCapture declaration when extraction failed (usage absent)", () => {
    const [parsed] = parseDispatchRuns([run({ usageCapture: "attribution_only" })]);
    expect(parsed.usageCapture).toBe("attribution_only");
    expect(parsed.usageInputTokens).toBeNull();
    expect(parsed.usageOutputTokens).toBeNull();
  });

  it("parses finishedAt as the exact UTC instant used for occurredAt materialization", () => {
    const [parsed] = parseDispatchRuns([run({ usage: usage(), usageCapture: "materialize" })]);
    expect(parsed.finishedAt.toISOString()).toBe("2026-08-10T00:10:00.000Z");
  });
});
