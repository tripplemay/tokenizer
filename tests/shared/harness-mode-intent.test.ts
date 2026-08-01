import { describe, expect, it } from "vitest";
import {
  HarnessModeAgentDescriptor,
  HarnessModeIntentPayload,
  HarnessModeToolDescriptor,
  normalizeHarnessModeIntentPayload,
  requiresHarnessToolCatalog,
  usesHarnessToolBindings,
  validateHarnessModeIntentPayload
} from "@/shared/harness-mode-intent";

const NOW = "2026-07-27T12:00:00Z";

const AGENTS: HarnessModeAgentDescriptor[] = [
  { id: "main-claude", roles: ["planner", "generator"], transport: "subagent", model_family: "claude" },
  { id: "builder-codex", roles: ["generator"], transport: "local-cli", model_family: "codex" },
  { id: "reviewer-kimi", roles: ["evaluator"], transport: "local-cli", model_family: "kimi" },
  { id: "reviewer-kimi-a2a", roles: ["evaluator"], transport: "a2a", model_family: "kimi" }
];

const TOOLS: HarnessModeToolDescriptor[] = [
  { tool: "claude", invocation: "subagent", role: "planner", model_family: "claude" },
  { tool: "kimi", invocation: "local-cli", role: "planner", model_family: "kimi" },
  { tool: "codex", invocation: "local-cli", role: "generator", model_family: "codex" },
  { tool: "kimi", invocation: "local-cli", role: "evaluator", model_family: "kimi" },
  { tool: "kimi", invocation: "a2a", role: "evaluator", model_family: "kimi" }
];

function autonomy(enabled = true) {
  if (!enabled) return { enabled: false };
  return {
    enabled: true,
    expires_at: "2026-07-28T12:00:00Z",
    auto_cross: ["B", "A"],
    budget: {
      max_tokens: 50_000,
      max_cost_usd: 10.5,
      max_wakes: 8,
      max_fix_rounds: 2
    },
    wake_interval_s: { building: 60, verifying: 120 },
    notify_on: ["done", "halt"]
  };
}

function intent(profile: "fast" | "heterogeneous" | "slow" = "fast", enabled = true): Record<string, any> {
  let assignments: Record<string, string> | null = null;
  if (profile === "heterogeneous") assignments = { generator: "builder-codex", evaluator: "reviewer-kimi" };
  if (profile === "slow") assignments = { generator: "builder-codex", evaluator: "reviewer-kimi-a2a" };
  return {
    intent_id: " intent-001 ",
    repo_key: "git@GitHub.com:Acme/Tokenizer.git",
    expected_head_sha: "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
    desired: {
      execution: { profile, role_assignments: assignments },
      autonomy: autonomy(enabled)
    },
    issued_by: " human@example.test ",
    issued_at: "2026-07-27T11:00:00Z",
    intent_expires_at: "2026-07-29T12:00:00.000Z"
  };
}

function expectCode(input: unknown, code: string, agents = AGENTS) {
  const result = validateHarnessModeIntentPayload(input, { now: NOW, agents });
  if (!("error" in result)) throw new Error(`expected validation error ${code}`);
  expect(result.error.code).toBe(code);
}

function toolBindingIntent(profile: "heterogeneous" | "slow" = "heterogeneous"): Record<string, any> {
  return {
    ...intent(profile),
    desired: {
      execution: {
        profile,
        role_bindings: {
          planner: { tool: "kimi", invocation: "local-cli" },
          generator: { tool: "codex", invocation: "local-cli" },
          evaluator: { tool: "kimi", invocation: profile === "slow" ? "a2a" : "local-cli" }
        }
      },
      autonomy: autonomy(true)
    }
  };
}

function expectToolCode(input: unknown, code: string, tools = TOOLS) {
  const result = validateHarnessModeIntentPayload(input, { now: NOW, tools });
  if (!("error" in result)) throw new Error(`expected validation error ${code}`);
  expect(result.error.code).toBe(code);
}

describe("normalizeHarnessModeIntentPayload", () => {
  it("normalizes identity fields while preserving the exact signed payload shape", () => {
    const result = normalizeHarnessModeIntentPayload(intent("fast", false), { now: NOW });
    expect(result).toEqual({
      intent_id: "intent-001",
      repo_key: "github.com/acme/tokenizer",
      expected_head_sha: "abcdef0123456789abcdef0123456789abcdef01",
      desired: {
        execution: { profile: "fast", role_assignments: null },
        autonomy: { enabled: false }
      },
      issued_by: "human@example.test",
      issued_at: "2026-07-27T11:00:00Z",
      intent_expires_at: "2026-07-29T12:00:00.000Z"
    } satisfies HarnessModeIntentPayload);
  });

  it("accepts heterogeneous with a non-A2A local-cli or same-session subagent route", () => {
    const result = normalizeHarnessModeIntentPayload(intent("heterogeneous"), { now: NOW, agents: AGENTS });
    expect(result.desired.execution).toEqual({
      profile: "heterogeneous",
      role_assignments: { generator: "builder-codex", evaluator: "reviewer-kimi" }
    });

    const bridgeAgents: HarnessModeAgentDescriptor[] = [
      { id: "builder-codex-bridge", roles: ["generator"], transport: "subagent", model_family: "codex" },
      { id: "reviewer-kimi-bridge", roles: ["evaluator"], transport: "subagent", model_family: "kimi" }
    ];
    const bridgeIntent = intent("heterogeneous");
    bridgeIntent.desired.execution.role_assignments = {
      generator: "builder-codex-bridge",
      evaluator: "reviewer-kimi-bridge"
    };
    expect(normalizeHarnessModeIntentPayload(bridgeIntent, { now: NOW, agents: bridgeAgents }).desired.execution).toEqual({
      profile: "heterogeneous",
      role_assignments: { generator: "builder-codex-bridge", evaluator: "reviewer-kimi-bridge" }
    });
  });

  it("accepts slow with one a2a and the other role on local-cli", () => {
    const result = normalizeHarnessModeIntentPayload(intent("slow"), { now: NOW, agents: AGENTS });
    expect(result.desired.execution.profile).toBe("slow");
  });

  it("accepts all bounded autonomy fields and only the two specified optional fields", () => {
    const result = normalizeHarnessModeIntentPayload(intent(), { now: NOW });
    expect(result.desired.autonomy).toEqual(autonomy());
  });
});

describe("strict object shapes and identity metadata", () => {
  it.each([
    ["intent", (value: any) => (value.extra = true)],
    ["desired", (value: any) => (value.desired.extra = true)],
    ["execution", (value: any) => (value.desired.execution.extra = true)],
    ["assignments", (value: any) => (value.desired.execution.role_assignments.extra = true)],
    ["autonomy", (value: any) => (value.desired.autonomy.extra = true)],
    ["budget", (value: any) => (value.desired.autonomy.budget.extra = true)]
  ])("rejects extra keys at %s", (_label, mutate) => {
    const value = intent("heterogeneous");
    mutate(value);
    expectCode(value, "extra_key");
  });

  it.each(["", "   "])("rejects blank intent identity %j", (blank) => {
    const value = intent();
    value.issued_by = blank;
    expectCode(value, "invalid_string");
  });

  it("rejects a repository value that normalizes to blank", () => {
    const value = intent();
    value.repo_key = "https://";
    expectCode(value, "invalid_string");
  });

  it.each(["abc123", "g".repeat(40), "a".repeat(39), "a".repeat(41)])("rejects invalid full HEAD %j", (sha) => {
    const value = intent();
    value.expected_head_sha = sha;
    expectCode(value, "invalid_head_sha");
  });

  it.each([
    ["offset instead of UTC Z", "2026-07-27T11:00:00-07:00"],
    ["invalid calendar day", "2026-02-30T11:00:00Z"],
    ["invalid hour", "2026-07-27T25:00:00Z"],
    ["date only", "2026-07-27"]
  ])("rejects %s", (_label, timestamp) => {
    const value = intent();
    value.issued_at = timestamp;
    expectCode(value, "invalid_timestamp");
  });

  it("rejects an expired intent", () => {
    const value = intent();
    value.intent_expires_at = NOW;
    expectCode(value, "expired_intent");
  });

  it("requires intent expiry to be later than issuance", () => {
    const value = intent();
    value.issued_at = "2026-07-30T00:00:00Z";
    expectCode(value, "invalid_expiry");
  });
});

describe("execution profiles and agent assignments", () => {
  it("rejects an unknown profile", () => {
    const value = intent();
    value.desired.execution.profile = "remote";
    expectCode(value, "invalid_profile");
  });

  it("requires fast assignments to be exactly null", () => {
    const value = intent();
    value.desired.execution.role_assignments = { generator: "builder-codex", evaluator: "reviewer-kimi" };
    expectCode(value, "invalid_assignments");
  });

  it("requires an agent snapshot for explicit assignments", () => {
    const result = validateHarnessModeIntentPayload(intent("heterogeneous"), { now: NOW });
    expect(result).toMatchObject({ ok: false, error: { code: "missing_agents" } });
  });

  it("rejects duplicate explicit agent ids", () => {
    const value = intent("heterogeneous");
    value.desired.execution.role_assignments.evaluator = "builder-codex";
    expectCode(value, "duplicate_agent");
  });

  it("rejects agents that do not exist", () => {
    const value = intent("heterogeneous");
    value.desired.execution.role_assignments.evaluator = "missing";
    expectCode(value, "unknown_agent");
  });

  it("rejects role-incompatible agents", () => {
    const value = intent("heterogeneous");
    value.desired.execution.role_assignments.generator = "reviewer-kimi-a2a";
    expectCode(value, "role_not_allowed");
  });

  it("rejects equal model families", () => {
    const agents = structuredClone(AGENTS);
    agents.find((agent) => agent.id === "reviewer-kimi")!.model_family = "codex";
    expectCode(intent("heterogeneous"), "same_model_family", agents);
  });

  it("rejects heterogeneous when an assigned agent uses a2a", () => {
    const value = intent("heterogeneous");
    value.desired.execution.role_assignments.evaluator = "reviewer-kimi-a2a";
    expectCode(value, "profile_transport_mismatch");
  });

  it("accepts heterogeneous when the independent pair uses same-session subagents", () => {
    const agents: HarnessModeAgentDescriptor[] = [
      { id: "sub-builder", roles: ["generator"], transport: "subagent", model_family: "codex" },
      { id: "sub-reviewer", roles: ["evaluator"], transport: "subagent", model_family: "kimi" }
    ];
    const value = intent("heterogeneous");
    value.desired.execution.role_assignments = { generator: "sub-builder", evaluator: "sub-reviewer" };
    expect(normalizeHarnessModeIntentPayload(value, { now: NOW, agents }).desired.execution.profile).toBe("heterogeneous");
  });

  it("rejects slow unless at least one assigned agent uses a2a", () => {
    const value = intent("slow");
    value.desired.execution.role_assignments.evaluator = "reviewer-kimi";
    expectCode(value, "profile_transport_mismatch");
  });
});

describe("v2 execution profiles and tool bindings", () => {
  it("accepts the legal v2 fast null shape without a catalog, while retaining the v2 feature gate", () => {
    const value = {
      ...intent("fast", false),
      desired: {
        execution: { profile: "fast", role_bindings: null },
        autonomy: { enabled: false }
      }
    };
    expect(usesHarnessToolBindings(value.desired)).toBe(true);
    expect(requiresHarnessToolCatalog(value.desired)).toBe(false);
    expect(normalizeHarnessModeIntentPayload(value, { now: NOW }).desired.execution).toEqual({
      profile: "fast",
      role_bindings: null
    });
  });

  it("keeps the signed v2 shape free of concrete agent ids", () => {
    const value = toolBindingIntent();
    expect(usesHarnessToolBindings(value.desired)).toBe(true);
    const result = normalizeHarnessModeIntentPayload(value, { now: NOW, tools: TOOLS });
    expect(result.desired.execution).toEqual({
      profile: "heterogeneous",
      role_bindings: {
        planner: { tool: "kimi", invocation: "local-cli" },
        generator: { tool: "codex", invocation: "local-cli" },
        evaluator: { tool: "kimi", invocation: "local-cli" }
      }
    });
    expect(JSON.stringify(result.desired.execution)).not.toContain("builder-codex");
  });

  it("allows a null Planner binding to delegate planning to the Coordinator", () => {
    const value = toolBindingIntent();
    value.desired.execution.role_bindings.planner = null;
    const result = normalizeHarnessModeIntentPayload(value, { now: NOW, tools: TOOLS });
    expect(result.desired.execution).toEqual({
      profile: "heterogeneous",
      role_bindings: {
        planner: null,
        generator: { tool: "codex", invocation: "local-cli" },
        evaluator: { tool: "kimi", invocation: "local-cli" }
      }
    });
  });

  it("requires an exact, role-complete tool capability catalog", () => {
    const missingPlanner = toolBindingIntent();
    delete missingPlanner.desired.execution.role_bindings.planner;
    expectToolCode(missingPlanner, "missing_key");

    const unknown = toolBindingIntent();
    unknown.desired.execution.role_bindings.evaluator.tool = "ghost";
    expectToolCode(unknown, "unknown_tool");

    expect(validateHarnessModeIntentPayload(toolBindingIntent(), { now: NOW })).toMatchObject({
      ok: false,
      error: { code: "missing_tool_catalog" }
    });
  });

  it("requires a viable independent generator/evaluator family pair", () => {
    const sameFamily = TOOLS.map((tool) =>
      tool.role === "evaluator" ? { ...tool, model_family: "codex" } : tool
    );
    expectToolCode(toolBindingIntent(), "same_model_family", sameFamily);
  });

  it("applies profile transport rules across planner, generator, and evaluator", () => {
    const heterogeneous = toolBindingIntent();
    heterogeneous.desired.execution.role_bindings.evaluator.invocation = "a2a";
    expectToolCode(heterogeneous, "profile_transport_mismatch");

    const slow = toolBindingIntent("slow");
    expect(normalizeHarnessModeIntentPayload(slow, { now: NOW, tools: TOOLS }).desired.execution.profile).toBe("slow");

    const noA2a = toolBindingIntent("slow");
    noA2a.desired.execution.role_bindings.evaluator.invocation = "local-cli";
    expectToolCode(noA2a, "profile_transport_mismatch");

    const bridgeTools: HarnessModeToolDescriptor[] = [
      { tool: "codex", invocation: "subagent", role: "generator", model_family: "codex" },
      { tool: "kimi", invocation: "subagent", role: "evaluator", model_family: "kimi" },
      { tool: "codex", invocation: "subagent", role: "planner", model_family: "codex" }
    ];
    const bridge = toolBindingIntent();
    bridge.desired.execution.role_bindings = {
      planner: null,
      generator: { tool: "codex", invocation: "subagent" },
      evaluator: { tool: "kimi", invocation: "subagent" }
    };
    expect(normalizeHarnessModeIntentPayload(bridge, { now: NOW, tools: bridgeTools }).desired.execution.profile).toBe("heterogeneous");
  });

  it("rejects non-null v2 bindings for fast and v1/v2 mixed execution objects", () => {
    const fast = toolBindingIntent();
    fast.desired.execution.profile = "fast";
    expectToolCode(fast, "invalid_bindings");

    const mixed = toolBindingIntent();
    mixed.desired.execution.role_assignments = { generator: "builder-codex", evaluator: "reviewer-kimi" };
    expectToolCode(mixed, "extra_key");
  });
});

describe("autonomy validation", () => {
  it("requires disabled autonomy to be exactly enabled=false", () => {
    const value = intent("fast", false);
    value.desired.autonomy.budget = { max_tokens: 0, max_cost_usd: 0, max_wakes: 1, max_fix_rounds: 0 };
    expectCode(value, "extra_key");
  });

  it("requires enabled autonomy to have a future absolute expiry", () => {
    const value = intent();
    value.desired.autonomy.expires_at = NOW;
    expectCode(value, "expired_autonomy");
  });

  it.each([[["C"]], [["A", "A"]]])("rejects invalid or duplicate gates: %j", (gates) => {
    const value = intent();
    value.desired.autonomy.auto_cross = gates;
    expectCode(value, gates[0] === "C" ? "invalid_gate" : "duplicate_gate");
  });

  it.each(["max_tokens", "max_cost_usd", "max_wakes", "max_fix_rounds"])("requires budget.%s", (field) => {
    const value = intent();
    delete value.desired.autonomy.budget[field];
    expectCode(value, "missing_key");
  });

  it.each([
    ["max_tokens", -1],
    ["max_tokens", 10_000_001],
    ["max_tokens", 1.5],
    ["max_tokens", Number.MAX_SAFE_INTEGER + 1],
    ["max_cost_usd", -1],
    ["max_cost_usd", 10_001],
    ["max_cost_usd", Number.NaN],
    ["max_cost_usd", Number.POSITIVE_INFINITY],
    ["max_cost_usd", -0],
    ["max_cost_usd", 0.000001],
    ["max_cost_usd", 1.234],
    ["max_cost_usd", 0.30000000000000004],
    ["max_wakes", 0],
    ["max_wakes", 1_001],
    ["max_fix_rounds", -1],
    ["max_fix_rounds", 6]
  ])("rejects unsafe or out-of-range budget.%s=%s", (field, number) => {
    const value = intent();
    value.desired.autonomy.budget[field] = number;
    expectCode(value, "invalid_number");
  });

  it("preserves standard cent-denominated USD values in the normalized signed payload", () => {
    const value = intent();
    value.desired.autonomy.budget.max_cost_usd = 0.29;
    expect(normalizeHarnessModeIntentPayload(value, { now: NOW }).desired.autonomy).toMatchObject({
      budget: { max_cost_usd: 0.29 }
    });
  });

  it.each([59, 86_401, 1.5, Number.MAX_SAFE_INTEGER + 1])("bounds wake intervals: %s", (seconds) => {
    const value = intent();
    value.desired.autonomy.wake_interval_s = { building: seconds };
    expectCode(value, "invalid_number");
  });

  it.each(["   ", "build phase", "构建", "_building", "building!", "__proto__", "prototype", "constructor", "x".repeat(65)])(
    "rejects non-stable wake interval phase %j",
    (phase) => {
      const value = intent();
      value.desired.autonomy.wake_interval_s = { [phase]: 60 };
      expectCode(value, "invalid_string");
    }
  );

  it("accepts stable ASCII wake interval phase identifiers", () => {
    const value = intent();
    value.desired.autonomy.wake_interval_s = { "build.v2": 60, verify_fix: 120 };
    expect(normalizeHarnessModeIntentPayload(value, { now: NOW }).desired.autonomy).toMatchObject({
      wake_interval_s: { "build.v2": 60, verify_fix: 120 }
    });
  });

  it.each([[["unknown"]], [["done", "done"]]])("rejects invalid or duplicate notification events: %j", (events) => {
    const value = intent();
    value.desired.autonomy.notify_on = events;
    expectCode(value, events[0] === "unknown" ? "invalid_notification" : "duplicate_notification");
  });
});
