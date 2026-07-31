import { describe, expect, it } from "vitest";
import {
  HarnessModeEditorValidationError,
  buildModeIntentRequest,
  currentHarnessModeSummary,
  modeIssuanceBlocker,
  parseHarnessDetailFeatures,
  parseHarnessDetailModes,
  type HarnessDetailAgent,
  type HarnessModeEditorDraft
} from "@/shared/harness-detail";
import { MIN_MODE_INTENT_AGENT_FEATURE_VERSION } from "@/shared/agent-feature-version";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const HEAD = "0123456789abcdef0123456789abcdef01234567";

const AGENTS: HarnessDetailAgent[] = [
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
    generatorId: "",
    evaluatorId: "",
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
  it("keeps legacy modes and agents readable when optional F004 fields are absent", () => {
    const snapshot = structuredClone(modeSnapshot());
    Reflect.deleteProperty(snapshot, "pendingDefaults");
    Reflect.deleteProperty(snapshot.dispatch.agents[1], "capabilities");
    const parsed = parseHarnessDetailModes(snapshot);
    expect(parsed?.execution).toBe("heterogeneous");
    expect(parsed?.pendingDefaults).toBeNull();
    expect(parsed?.dispatch.agentSnapshotUsable).toBe(true);
    expect(parsed?.dispatch.agents[1]).toMatchObject({ id: "reviewer-kimi", capabilities: [] });
  });

  it("does not invent assignments or transport for incomplete legacy snapshots", () => {
    const snapshot = structuredClone(modeSnapshot());
    Reflect.deleteProperty(snapshot.dispatch.assignments, "generator");
    Reflect.deleteProperty(snapshot.dispatch.assignments, "evaluator");
    Reflect.deleteProperty(snapshot.dispatch.agents[1], "transport");
    const parsed = parseHarnessDetailModes(snapshot);
    expect(currentHarnessModeSummary(parsed)?.execution).toEqual({
      profile: "heterogeneous",
      roleAssignments: null
    });
    expect(parsed?.dispatch.agents[1].transport).toBe("");
    expect(parsed?.dispatch.agentSnapshotUsable).toBe(false);
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
  });
});

describe("Harness mode editor validation", () => {
  it("sends null assignments for fast and explicit assignments for heterogeneous", () => {
    const fast = buildModeIntentRequest("project-1", draft(), AGENTS, NOW);
    expect(fast).toEqual({
      projectId: "project-1",
      desired: { execution: { profile: "fast", role_assignments: null }, autonomy: { enabled: false } },
      intentExpiresAt: "2026-07-28T12:00:00.000Z"
    });

    const heterogeneous = buildModeIntentRequest("project-1", draft({
      profile: "heterogeneous",
      generatorId: "builder-codex",
      evaluatorId: "reviewer-kimi"
    }), AGENTS, NOW);
    expect(heterogeneous.desired.execution).toEqual({
      profile: "heterogeneous",
      role_assignments: { generator: "builder-codex", evaluator: "reviewer-kimi" }
    });
  });

  it("builds bounded autonomy without adding unrequested control fields", () => {
    const request = buildModeIntentRequest("project-1", draft({
      autonomyEnabled: true,
      autonomyExpiresAt: "2026-07-29T12:00:00.000Z",
      autoCross: ["A", "B"],
      notifyOn: ["halt", "budget_80pct"]
    }), AGENTS, NOW);
    expect(request.desired.autonomy).toEqual({
      enabled: true,
      expires_at: "2026-07-29T12:00:00.000Z",
      auto_cross: ["A", "B"],
      budget: { max_tokens: 2000000, max_cost_usd: 20, max_wakes: 60, max_fix_rounds: 3 },
      notify_on: ["halt", "budget_80pct"]
    });
    expect(request.desired.autonomy).not.toHaveProperty("wake_interval_s");
  });

  it("rejects missing, duplicate, unknown, role-mismatched, and same-family agents", () => {
    expectCode(() => buildModeIntentRequest("p", draft({ profile: "heterogeneous" }), AGENTS, NOW), "invalid_string");
    expectCode(() => buildModeIntentRequest("p", draft({
      profile: "heterogeneous", generatorId: "builder-codex", evaluatorId: "builder-codex"
    }), AGENTS, NOW), "duplicate_agent");
    expectCode(() => buildModeIntentRequest("p", draft({
      profile: "heterogeneous", generatorId: "ghost", evaluatorId: "reviewer-kimi"
    }), AGENTS, NOW), "unknown_agent");
    expectCode(() => buildModeIntentRequest("p", draft({
      profile: "heterogeneous", generatorId: "reviewer-kimi", evaluatorId: "builder-codex"
    }), AGENTS, NOW), "role_not_allowed");
    expectCode(() => buildModeIntentRequest("p", draft({
      profile: "heterogeneous", generatorId: "builder-codex", evaluatorId: "reviewer-codex"
    }), [...AGENTS, { ...AGENTS[1], id: "reviewer-codex", modelFamily: "codex" }], NOW), "same_model_family");
  });

  it("enforces heterogeneous and slow transport constraints", () => {
    expectCode(() => buildModeIntentRequest("p", draft({
      profile: "heterogeneous", generatorId: "builder-codex", evaluatorId: "reviewer-kimi-a2a"
    }), AGENTS, NOW), "profile_transport_mismatch");
    expectCode(() => buildModeIntentRequest("p", draft({
      profile: "slow", generatorId: "builder-codex", evaluatorId: "reviewer-kimi"
    }), AGENTS, NOW), "profile_transport_mismatch");

    const slow = buildModeIntentRequest("p", draft({
      profile: "slow", generatorId: "builder-codex", evaluatorId: "reviewer-kimi-a2a"
    }), AGENTS, NOW);
    expect(slow.desired.execution.profile).toBe("slow");
  });

  it("rejects invalid or expired absolute dates and out-of-range budgets", () => {
    expectCode(() => buildModeIntentRequest("p", draft({ intentExpiresAt: "" }), AGENTS, NOW), "invalid_timestamp");
    expectCode(() => buildModeIntentRequest("p", draft({ intentExpiresAt: "2026-07-27T11:00:00.000Z" }), AGENTS, NOW), "expired_intent");
    expectCode(() => buildModeIntentRequest("p", draft({
      autonomyEnabled: true,
      autonomyExpiresAt: "2026-07-27T11:00:00.000Z"
    }), AGENTS, NOW), "expired_autonomy");
    expectCode(() => buildModeIntentRequest("p", draft({
      autonomyEnabled: true,
      autonomyExpiresAt: "2026-07-29T12:00:00.000Z",
      maxTokens: "10000001"
    }), AGENTS, NOW), "invalid_number");
    expectCode(() => buildModeIntentRequest("p", draft({
      autonomyEnabled: true,
      autonomyExpiresAt: "2026-07-29T12:00:00.000Z",
      maxWakes: "1.5"
    }), AGENTS, NOW), "invalid_number");
  });
});
