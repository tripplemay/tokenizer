import { describe, expect, it } from "vitest";
import {
  HarnessModeEditorValidationError,
  buildModeIntentRequest,
  currentHarnessModeSummary,
  modeIssuanceBlocker,
  parseHarnessDetailFeatures,
  parseHarnessDetailModes,
  type HarnessDetailAgent,
  type HarnessDetailToolCapability,
  type HarnessModeEditorDraft
} from "@/shared/harness-detail";
import { toolCatalogLabelForInvocation } from "@/shared/harness-tool-catalog";
import {
  MIN_MODE_INTENT_AGENT_FEATURE_VERSION,
  MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION
} from "@/shared/agent-feature-version";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const HEAD = "0123456789abcdef0123456789abcdef01234567";

const AGENTS: HarnessDetailAgent[] = [
  {
    id: "main-claude",
    roles: ["planner", "generator"],
    capabilities: ["plan", "build"],
    modelFamily: "claude",
    transport: "subagent",
    adapter: null,
    sandboxed: false
  },
  {
    id: "builder-codex",
    roles: ["generator"],
    capabilities: ["build", "fix"],
    modelFamily: "codex",
    transport: "local-cli",
    adapter: "codex",
    sandboxed: true
  },
  {
    id: "reviewer-kimi",
    roles: ["evaluator"],
    capabilities: ["verify"],
    modelFamily: "kimi",
    transport: "subagent",
    adapter: null,
    sandboxed: false
  },
  {
    id: "reviewer-kimi-a2a",
    roles: ["evaluator"],
    capabilities: ["verify"],
    modelFamily: "kimi",
    transport: "a2a",
    adapter: null,
    sandboxed: true
  }
];

const TOOLS: HarnessDetailToolCapability[] = [
  {
    tool: "claude-code",
    label: "Claude Code",
    invocation: "subagent",
    role: "planner",
    agentCount: 1,
    modelFamilies: ["claude"],
    capabilities: ["plan"]
  },
  {
    tool: "codex",
    label: "Codex",
    invocation: "local-cli",
    role: "generator",
    agentCount: 1,
    modelFamilies: ["codex"],
    capabilities: ["build", "fix"]
  },
  {
    tool: "kimi",
    label: "Kimi",
    invocation: "local-cli",
    role: "planner",
    agentCount: 1,
    modelFamilies: ["kimi"],
    capabilities: ["plan"]
  },
  {
    tool: "kimi",
    label: "Kimi",
    invocation: "local-cli",
    role: "evaluator",
    agentCount: 1,
    modelFamilies: ["kimi"],
    capabilities: ["verify"]
  },
  {
    tool: "kimi",
    label: "Kimi Remote",
    invocation: "a2a",
    role: "evaluator",
    agentCount: 1,
    modelFamilies: ["kimi"],
    capabilities: ["verify"]
  }
];

function modeSnapshot() {
  return {
    framework: {
      version: "1.5.0",
      adopted: false,
      managedCount: 100,
      drift: { ok: 100, modified: 0, missing: 0, customized: 0 }
    },
    execution: "heterogeneous",
    autonomy: { enabled: false, policyValid: null, authorizedBy: null, expiresAt: null, status: null },
    dispatch: {
      enabled: true,
      assignments: { generator: "builder-codex", evaluator: "reviewer-kimi" },
      agents: AGENTS,
      toolCatalog: TOOLS,
      familyExclusive: true,
      issues: []
    },
    gate: { pubInstalled: true, guardMode: "signature" },
    machinery: { denyListMerged: true, hooks: ["dispatch"], missing: [] }
  };
}

function draft(overrides: Partial<HarnessModeEditorDraft> = {}): HarnessModeEditorDraft {
  return {
    profile: "fast",
    plannerTool: "claude-code",
    plannerInvocation: "subagent",
    generatorTool: "codex",
    generatorInvocation: "local-cli",
    evaluatorTool: "kimi",
    evaluatorInvocation: "local-cli",
    intentExpiresAt: "2026-07-28T12:00:00.000Z",
    autonomyEnabled: false,
    autonomyExpiresAt: "",
    maxTokens: "2000000",
    maxCostUsd: "20",
    maxWakes: "60",
    maxFixRounds: "3",
    autoCross: ["A"],
    notifyOn: ["halt", "done"],
    ...overrides
  };
}

function expectCode(run: () => unknown, code: string) {
  try {
    run();
    throw new Error("expected validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(HarnessModeEditorValidationError);
    if (!(error instanceof HarnessModeEditorValidationError)) throw error;
    expect(error.code).toBe(code);
  }
}

describe("Harness detail snapshot helpers", () => {
  it("keeps labels scoped to the selected tool and invocation", () => {
    expect(toolCatalogLabelForInvocation(TOOLS, "kimi", "local-cli")).toBe("Kimi");
    expect(toolCatalogLabelForInvocation(TOOLS, "kimi", "a2a")).toBe("Kimi Remote");
  });

  it("keeps legacy modes and agents readable when optional F004 fields are absent", () => {
    const snapshot = structuredClone(modeSnapshot());
    Reflect.deleteProperty(snapshot, "pendingDefaults");
    Reflect.deleteProperty(snapshot.dispatch.agents[2], "capabilities");
    const parsed = parseHarnessDetailModes(snapshot);
    expect(parsed?.execution).toBe("heterogeneous");
    expect(parsed?.pendingDefaults).toBeNull();
    expect(parsed?.dispatch.agentSnapshotUsable).toBe(true);
    expect(parsed?.dispatch.agents[2]).toMatchObject({ id: "reviewer-kimi", capabilities: [] });
    expect(parsed?.dispatch.toolCatalogUsable).toBe(true);
    expect(parsed?.dispatch.toolCatalog.find((tool) => tool.tool === "claude-code")).toMatchObject({
      label: "Claude Code",
      capabilities: ["plan"]
    });
  });

  it("does not invent assignments or transport for incomplete legacy snapshots", () => {
    const snapshot = structuredClone(modeSnapshot());
    Reflect.deleteProperty(snapshot.dispatch.assignments, "generator");
    Reflect.deleteProperty(snapshot.dispatch.assignments, "evaluator");
    Reflect.deleteProperty(snapshot.dispatch.agents[1], "transport");
    const parsed = parseHarnessDetailModes(snapshot);
    expect(currentHarnessModeSummary(parsed)?.execution).toEqual({
      profile: "heterogeneous",
      roleAssignments: null,
      roleBindings: null
    });
    expect(parsed?.dispatch.agents[1].transport).toBe("");
    expect(parsed?.dispatch.agentSnapshotUsable).toBe(false);
  });

  it("prefers the resolved v2 tool bindings over internal agent ids", () => {
    const snapshot = structuredClone(modeSnapshot());
    snapshot.execution = "slow";
    Object.assign(snapshot, {
      current: {
        profile: "slow",
        roleBindings: {
          planner: { tool: "claude-code", invocation: "subagent", modelFamily: "claude" },
          generator: { tool: "codex", invocation: "local-cli", modelFamily: "codex" },
          evaluator: { tool: "kimi", invocation: "a2a", modelFamily: "kimi" }
        }
      }
    });

    const summary = currentHarnessModeSummary(parseHarnessDetailModes(snapshot));
    expect(summary?.execution).toEqual({
      profile: "slow",
      roleAssignments: null,
      roleBindings: {
        planner: { tool: "claude-code", invocation: "subagent", modelFamily: "claude" },
        generator: { tool: "codex", invocation: "local-cli", modelFamily: "codex" },
        evaluator: { tool: "kimi", invocation: "a2a", modelFamily: "kimi" }
      }
    });
    expect(JSON.stringify(summary)).not.toContain("builder-codex");
  });

  it("defensively drops malformed feature entries while retaining readable legacy fields", () => {
    expect(parseHarnessDetailFeatures([
      { id: "F001", title: "one", status: "completed" },
      null,
      { id: "", title: "bad" },
      { id: "F002", executor: "generator" }
    ])).toEqual([
      { id: "F001", title: "one", status: "completed", executor: null },
      { id: "F002", title: null, status: null, executor: "generator" }
    ]);
  });

  it("returns precise issuance blockers in fail-closed order", () => {
    const modes = parseHarnessDetailModes(modeSnapshot());
    const ready = {
      signingKeyReady: true,
      reportedAt: new Date("2026-07-27T11:55:00.000Z"),
      agentFeatureVersion: MIN_MODE_INTENT_AGENT_FEATURE_VERSION,
      headSha: HEAD,
      modes,
      now: NOW
    };
    expect(modeIssuanceBlocker(ready)).toBeNull();
    expect(modeIssuanceBlocker({ ...ready, signingKeyReady: false })).toBe("signingKeyUnavailable");
    expect(modeIssuanceBlocker({ ...ready, reportedAt: new Date("2026-07-27T11:30:00.000Z") })).toBe("reportStale");
    expect(modeIssuanceBlocker({ ...ready, agentFeatureVersion: MIN_MODE_INTENT_AGENT_FEATURE_VERSION - 1 })).toBe("agentUpgradeRequired");
    expect(modeIssuanceBlocker({ ...ready, headSha: "short" })).toBe("headNotFull");
    expect(modeIssuanceBlocker({ ...ready, modes: null })).toBe("agentSnapshotUnavailable");
    expect(modeIssuanceBlocker({ ...ready, requiresToolBindings: true })).toBe("toolBindingAgentUpgradeRequired");
    expect(modeIssuanceBlocker({
      ...ready,
      requiresToolBindings: true,
      agentFeatureVersion: MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION
    })).toBeNull();
  });
});

describe("Harness mode editor validation", () => {
  it("keeps fast on v1 and sends v2 tool bindings for heterogeneous", () => {
    const fast = buildModeIntentRequest("project-1", draft(), TOOLS, NOW);
    expect(fast).toEqual({
      projectId: "project-1",
      desired: { execution: { profile: "fast", role_assignments: null }, autonomy: { enabled: false } },
      intentExpiresAt: "2026-07-28T12:00:00.000Z"
    });

    const heterogeneous = buildModeIntentRequest("project-1", draft({
      profile: "heterogeneous"
    }), TOOLS, NOW);
    expect(heterogeneous.desired.execution).toEqual({
      profile: "heterogeneous",
      role_bindings: {
        planner: { tool: "claude-code", invocation: "subagent" },
        generator: { tool: "codex", invocation: "local-cli" },
        evaluator: { tool: "kimi", invocation: "local-cli" }
      }
    });
  });

  it("builds bounded autonomy without adding unrequested control fields", () => {
    const request = buildModeIntentRequest("project-1", draft({
      autonomyEnabled: true,
      autonomyExpiresAt: "2026-07-29T12:00:00.000Z",
      autoCross: ["A", "B"],
      notifyOn: ["halt", "budget_80pct"]
    }), TOOLS, NOW);
    expect(request.desired.autonomy).toEqual({
      enabled: true,
      expires_at: "2026-07-29T12:00:00.000Z",
      auto_cross: ["A", "B"],
      budget: { max_tokens: 2000000, max_cost_usd: 20, max_wakes: 60, max_fix_rounds: 3 },
      notify_on: ["halt", "budget_80pct"]
    });
    expect(request.desired.autonomy).not.toHaveProperty("wake_interval_s");
  });

  it("keeps standard decimal USD input while rejecting non-cents values before a request", () => {
    for (const [input, expected] of [["20", 20], ["20.50", 20.5], ["0.29", 0.29]] as const) {
      const cents = buildModeIntentRequest("project-1", draft({
        autonomyEnabled: true,
        autonomyExpiresAt: "2026-07-29T12:00:00.000Z",
        maxCostUsd: input
      }), TOOLS, NOW);
      expect(cents.desired.autonomy).toMatchObject({ budget: { max_cost_usd: expected } });
    }

    for (const maxCostUsd of ["-0", "0.000001", "1.234"]) {
      expectCode(() => buildModeIntentRequest("project-1", draft({
        autonomyEnabled: true,
        autonomyExpiresAt: "2026-07-29T12:00:00.000Z",
        maxCostUsd
      }), TOOLS, NOW), "invalid_number");
    }
  });

  it("rejects missing, unavailable, and non-independent tool bindings", () => {
    expectCode(() => buildModeIntentRequest("p", draft({
      profile: "heterogeneous", plannerTool: ""
    }), TOOLS, NOW), "invalid_string");
    expectCode(() => buildModeIntentRequest("p", draft({
      profile: "heterogeneous", evaluatorTool: "ghost"
    }), TOOLS, NOW), "unknown_tool");
    const sameFamilyTools = TOOLS.map((tool) =>
      tool.role === "evaluator" ? { ...tool, modelFamilies: ["codex"] } : tool
    );
    expectCode(() => buildModeIntentRequest("p", draft({ profile: "heterogeneous" }), sameFamilyTools, NOW), "same_model_family");
  });

  it("enforces heterogeneous and slow transport constraints", () => {
    expectCode(() => buildModeIntentRequest("p", draft({
      profile: "heterogeneous", evaluatorInvocation: "a2a"
    }), TOOLS, NOW), "profile_transport_mismatch");
    expectCode(() => buildModeIntentRequest("p", draft({
      profile: "slow"
    }), TOOLS, NOW), "profile_transport_mismatch");

    const slow = buildModeIntentRequest("p", draft({
      profile: "slow", evaluatorInvocation: "a2a"
    }), TOOLS, NOW);
    expect(slow.desired.execution.profile).toBe("slow");
  });

  it("rejects invalid or expired absolute dates and out-of-range budgets", () => {
    expectCode(() => buildModeIntentRequest("p", draft({ intentExpiresAt: "" }), TOOLS, NOW), "invalid_timestamp");
    expectCode(() => buildModeIntentRequest("p", draft({ intentExpiresAt: "2026-07-27T11:00:00.000Z" }), TOOLS, NOW), "expired_intent");
    expectCode(() => buildModeIntentRequest("p", draft({
      autonomyEnabled: true,
      autonomyExpiresAt: "2026-07-27T11:00:00.000Z"
    }), TOOLS, NOW), "expired_autonomy");
    expectCode(() => buildModeIntentRequest("p", draft({
      autonomyEnabled: true,
      autonomyExpiresAt: "2026-07-29T12:00:00.000Z",
      maxTokens: "10000001"
    }), TOOLS, NOW), "invalid_number");
    expectCode(() => buildModeIntentRequest("p", draft({
      autonomyEnabled: true,
      autonomyExpiresAt: "2026-07-29T12:00:00.000Z",
      maxWakes: "1.5"
    }), TOOLS, NOW), "invalid_number");
  });
});
