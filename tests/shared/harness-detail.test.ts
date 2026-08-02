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
import {
  toolCatalogLabelForInvocation,
  type HarnessVmBridgeProviderProof
} from "@/shared/harness-tool-catalog";
import {
  MIN_MODE_INTENT_AGENT_FEATURE_VERSION,
  MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION
} from "@/shared/agent-feature-version";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const PROVIDER_DIGEST = "a".repeat(64);

function vmProviderProof(now: Date): HarnessVmBridgeProviderProof {
  return {
    id: "harness-vm-v1",
    kind: "vm-v1",
    contractSha256: PROVIDER_DIGEST,
    attestation: {
      version: "harness/external-bridge-provider-attestation/1",
      providerId: "harness-vm-v1",
      providerKind: "vm-v1",
      contractSha256: PROVIDER_DIGEST,
      phase: "catalog",
      nonceSha256: "b".repeat(64),
      issuedAt: new Date(now.getTime() - 1_000).toISOString(),
      expiresAt: new Date(now.getTime() + 120_000).toISOString(),
      imageSha256: "c".repeat(64),
      runnerSha256: "d".repeat(64),
      cliBundleSha256: "e".repeat(64),
      brokerPolicySha256: "f".repeat(64)
    }
  };
}

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
    plannerTool: "kimi",
    plannerInvocation: "local-cli",
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
    expect(parsed?.dispatch.integrations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "reviewer-kimi", tool: "reviewer-kimi" })
    ]));
    expect(parsed?.dispatch.agents[2]).toMatchObject({ id: "reviewer-kimi", capabilities: [] });
    expect(parsed?.dispatch.toolCatalogUsable).toBe(true);
    expect(parsed?.dispatch.toolCatalog).not.toContainEqual(
      expect.objectContaining({ invocation: "subagent" })
    );
    expect(parsed?.dispatch.toolCatalog).toContainEqual(
      expect.objectContaining({ tool: "kimi", invocation: "local-cli", role: "planner" })
    );
  });

  it("reads full external same-session bridge observations while rejecting partial metadata", () => {
    const snapshot: any = structuredClone(modeSnapshot());
    snapshot.dispatch.integrations = [{
      id: "kimi-bridge",
      tool: "kimi",
      label: "Kimi Code",
      modelFamily: "kimi",
      roles: ["planner", "generator", "evaluator"],
      invocations: ["local-cli", "subagent"],
      capabilities: ["plan", "build", "verify"],
      localCli: true,
      subagent: true,
      bridgeId: "kimi-acp-agent",
      bridgeKind: "acp-agent",
      sessionScope: "same-session",
      bridgeProtocol: "acp-native-agent/v1",
      bridgeCommand: ["kimi", "acp"],
      adapterBridgeCommand: ["kimi", "acp"],
      bridgeRoles: ["planner", "generator", "evaluator"],
      a2aTargetCount: 0,
      sandboxed: true
    }];
    const parsed = parseHarnessDetailModes(snapshot);
    expect(parsed?.dispatch.integrationSnapshotUsable).toBe(true);
    expect(parsed?.dispatch.integrations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "kimi-bridge",
        bridgeId: "kimi-acp-agent",
        bridgeKind: "acp-agent",
        sessionScope: "same-session"
      })
    ]));

    const partial = structuredClone(snapshot);
    delete (partial.dispatch.integrations[0] as Record<string, unknown>).bridgeKind;
    expect(parseHarnessDetailModes(partial)?.dispatch.integrationSnapshotUsable).toBe(false);

    const unverified = structuredClone(snapshot);
    delete (unverified.dispatch.integrations[0] as Record<string, unknown>).bridgeId;
    delete (unverified.dispatch.integrations[0] as Record<string, unknown>).bridgeKind;
    delete (unverified.dispatch.integrations[0] as Record<string, unknown>).sessionScope;
    expect(parseHarnessDetailModes(unverified)?.dispatch.integrationSnapshotUsable).toBe(false);
  });

  it("keeps bridge reports observable while removing external subagent choices from the editor", () => {
    const snapshot: any = structuredClone(modeSnapshot());
    snapshot.dispatch.integrations = [{
      id: "kimi-bridge",
      tool: "kimi",
      label: "Kimi Code",
      modelFamily: "kimi",
      roles: ["planner", "generator", "evaluator"],
      invocations: ["local-cli", "subagent"],
      capabilities: ["plan", "build", "verify"],
      localCli: true,
      subagent: true,
      bridgeId: "kimi-acp-agent",
      bridgeKind: "session-bridge-v1",
      sessionScope: "same-session",
      bridgeProtocol: "acp-native-agent/v1",
      bridgeCommand: ["kimi", "acp"],
      adapterBridgeCommand: ["kimi", "acp"],
      bridgeRoles: ["planner", "generator", "evaluator"],
      a2aTargetCount: 0,
      sandboxed: true
    }];
    snapshot.dispatch.toolCatalog = [
      ...TOOLS.filter((entry) => entry.invocation !== "subagent"),
      ...["planner", "generator", "evaluator"].map((role) => ({
        tool: "kimi",
        label: "Kimi Code",
        invocation: "subagent",
        role,
        agentCount: 1,
        modelFamilies: ["kimi"],
        capabilities: ["plan", "build", "verify"]
      }))
    ];
    const parsed = parseHarnessDetailModes(snapshot);
    expect(parsed?.dispatch.integrationSnapshotUsable).toBe(true);
    expect(parsed?.dispatch.toolCatalogUsable).toBe(true);
    expect(parsed?.dispatch.toolCatalog).not.toContainEqual(
      expect.objectContaining({ invocation: "subagent" })
    );
    expect(parsed?.dispatch.toolCatalog).toContainEqual(
      expect.objectContaining({ tool: "codex", invocation: "local-cli", role: "generator" })
    );

    const fakeBridge = structuredClone(snapshot);
    fakeBridge.dispatch.integrations[0].adapterBridgeCommand = ["codex", "acp"];
    const fakeParsed = parseHarnessDetailModes(fakeBridge);
    expect(fakeParsed?.dispatch.integrationSnapshotUsable).toBe(false);
    expect(fakeParsed?.dispatch.toolCatalogUsable).toBe(false);
  });

  it("admits only a fresh strict VM provider proof from the catalog", () => {
    const snapshot: any = structuredClone(modeSnapshot());
    const proof = vmProviderProof(new Date());
    snapshot.dispatch.toolCatalog = [
      ...TOOLS.filter((entry) => entry.invocation !== "subagent"),
      ...["planner", "generator", "evaluator"].map((role) => ({
        tool: "kimi",
        label: "Kimi Code",
        invocation: "subagent",
        role,
        agentCount: 1,
        modelFamilies: ["kimi"],
        capabilities: ["plan", "build", "verify"],
        subagentProvider: proof
      }))
    ];

    const parsed = parseHarnessDetailModes(snapshot);
    expect(parsed?.dispatch.toolCatalogUsable).toBe(true);
    expect(parsed?.dispatch.toolCatalog).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: "kimi", invocation: "subagent", role: "generator" })
    ]));

    const expired = structuredClone(snapshot);
    expired.dispatch.toolCatalog.at(-1).subagentProvider = vmProviderProof(
      new Date(Date.now() - 10 * 60 * 1_000)
    );
    // All three catalog entries need the same proof, so use the expired proof
    // for the whole external route rather than trusting an integration card.
    for (const entry of expired.dispatch.toolCatalog) {
      if (entry.invocation === "subagent") entry.subagentProvider = expired.dispatch.toolCatalog.at(-1).subagentProvider;
    }
    expect(parseHarnessDetailModes(expired)?.dispatch.toolCatalog).not.toContainEqual(
      expect.objectContaining({ invocation: "subagent" })
    );

    const forged = structuredClone(snapshot);
    forged.dispatch.toolCatalog.find((entry: any) => entry.invocation === "subagent").subagentProvider.id = "forged-vm";
    expect(parseHarnessDetailModes(forged)?.dispatch.toolCatalogUsable).toBe(false);
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

  it("accepts a null Planner binding and preserves Coordinator semantics", () => {
    const snapshot: any = structuredClone(modeSnapshot());
    snapshot.execution = "slow";
    snapshot.dispatch.assignments.planner = null;
    snapshot.current = {
      profile: "slow",
      roleBindings: {
        planner: null,
        generator: { tool: "codex", invocation: "local-cli", modelFamily: "codex" },
        evaluator: { tool: "kimi", invocation: "a2a", modelFamily: "kimi" }
      }
    };
    const parsed = parseHarnessDetailModes(snapshot);
    expect(parsed?.current?.roleBindings.planner).toBeNull();
    expect(parsed?.dispatch.assignments.planner).toBeNull();
    expect(currentHarnessModeSummary(parsed)?.execution.roleBindings?.planner).toBeNull();
  });

  it("keeps Generator and Evaluator choices usable when Coordinator owns Planner", () => {
    const snapshot: any = structuredClone(modeSnapshot());
    snapshot.dispatch.assignments.planner = null;
    snapshot.dispatch.toolCatalog = TOOLS.filter((tool) =>
      tool.role !== "planner" && tool.invocation !== "subagent"
    );

    const parsed = parseHarnessDetailModes(snapshot);
    expect(parsed?.dispatch.toolCatalogUsable).toBe(true);
    expect(parsed?.dispatch.toolCatalog).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "generator", tool: "codex", invocation: "local-cli" }),
      expect.objectContaining({ role: "evaluator", tool: "kimi", invocation: "local-cli" })
    ]));
    expect(buildModeIntentRequest("project-1", draft({
      profile: "heterogeneous",
      plannerTool: "",
      plannerInvocation: ""
    }), parsed?.dispatch.toolCatalog ?? [], NOW).desired.execution).toMatchObject({
      role_bindings: { planner: null }
    });
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
      modes: null,
      requiresToolBindings: true
    })).toBe("toolBindingAgentUpgradeRequired");
    expect(modeIssuanceBlocker({
      ...ready,
      requiresToolBindings: true,
      agentFeatureVersion: MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION
    })).toBeNull();
  });
});

describe("Harness mode editor validation", () => {
  it("keeps legacy fast compatibility while sending v2 fast for tool-binding devices", () => {
    const fast = buildModeIntentRequest("project-1", draft(), TOOLS, NOW);
    expect(fast).toEqual({
      projectId: "project-1",
      desired: { execution: { profile: "fast", role_assignments: null }, autonomy: { enabled: false } },
      intentExpiresAt: "2026-07-28T12:00:00.000Z"
    });

    const toolBindingFast = buildModeIntentRequest("project-1", draft(), TOOLS, NOW, { useToolBindings: true });
    expect(toolBindingFast).toEqual({
      projectId: "project-1",
      desired: { execution: { profile: "fast", role_bindings: null }, autonomy: { enabled: false } },
      intentExpiresAt: "2026-07-28T12:00:00.000Z"
    });

    const heterogeneous = buildModeIntentRequest("project-1", draft({
      profile: "heterogeneous"
    }), TOOLS, NOW);
    expect(heterogeneous.desired.execution).toEqual({
      profile: "heterogeneous",
      role_bindings: {
        planner: { tool: "kimi", invocation: "local-cli" },
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

  it("allows Coordinator as the default Planner while rejecting partial bindings", () => {
    const coordinator = buildModeIntentRequest("p", draft({
      profile: "heterogeneous", plannerTool: "", plannerInvocation: ""
    }), TOOLS, NOW);
    expect(coordinator.desired.execution).toMatchObject({
      profile: "heterogeneous",
      role_bindings: { planner: null }
    });
    expectCode(() => buildModeIntentRequest("p", draft({
      profile: "heterogeneous", plannerTool: "", plannerInvocation: "local-cli"
    }), TOOLS, NOW), "invalid_string");
    expectCode(() => buildModeIntentRequest("p", draft({
      profile: "heterogeneous", evaluatorTool: "ghost"
    }), TOOLS, NOW), "unknown_tool");
    expectCode(() => buildModeIntentRequest("p", draft({
      profile: "heterogeneous", plannerTool: "claude-code", plannerInvocation: "subagent"
    }), TOOLS, NOW), "unknown_tool");
    const sameFamilyTools = TOOLS.map((tool) =>
      tool.role === "evaluator" ? { ...tool, modelFamilies: ["codex"] } : tool
    );
    expectCode(() => buildModeIntentRequest("p", draft({ profile: "heterogeneous" }), sameFamilyTools, NOW), "same_model_family");
  });

  it("rechecks the provider proof at client-side mode-intent validation time", () => {
    const liveTools = TOOLS.map((tool) => tool.invocation === "subagent"
      ? { ...tool, subagentProvider: vmProviderProof(NOW) }
      : tool
    );
    const accepted = buildModeIntentRequest("p", draft({
      profile: "heterogeneous",
      plannerTool: "claude-code",
      plannerInvocation: "subagent"
    }), liveTools, NOW);
    expect(accepted.desired.execution).toMatchObject({
      role_bindings: { planner: { tool: "claude-code", invocation: "subagent" } }
    });

    const expiredTools = TOOLS.map((tool) => tool.invocation === "subagent"
      ? { ...tool, subagentProvider: vmProviderProof(new Date(NOW.getTime() - 10 * 60 * 1_000)) }
      : tool
    );
    expectCode(() => buildModeIntentRequest("p", draft({
      profile: "heterogeneous",
      plannerTool: "claude-code",
      plannerInvocation: "subagent"
    }), expiredTools, NOW), "unknown_tool");
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
