import {
  HARNESS_AUTONOMY_LIMITS,
  HARNESS_EXECUTION_PROFILES,
  HARNESS_TRANSPORTS,
  HarnessModeIntentValidationError,
  normalizeHarnessModeIntentPayload,
  type HarnessAutonomyGate,
  type HarnessAutonomyNotification,
  type HarnessExecutionProfile,
  type HarnessModeAgentDescriptor,
  type HarnessModeIntentDesired,
  type HarnessTransport
} from "@/shared/harness-mode-intent";
import { DEVICE_ONLINE_MS } from "@/shared/device-status";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringList(value: unknown, maxItems = 100): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map(text)
    .filter((item): item is string => item !== null);
}

export type HarnessDetailFeature = {
  id: string;
  title: string | null;
  status: string | null;
  executor: string | null;
};

export function parseHarnessDetailFeatures(value: unknown): HarnessDetailFeature[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).flatMap((item) => {
    const feature = record(item);
    const id = text(feature?.id);
    if (!feature || !id) return [];
    return [{
      id,
      title: text(feature.title),
      status: text(feature.status),
      executor: text(feature.executor)
    }];
  });
}

export type HarnessDetailAgent = {
  id: string;
  roles: string[];
  capabilities: string[];
  modelFamily: string | null;
  transport: string;
  adapter: string | null;
  sandboxed: boolean | null;
};

export type HarnessDesiredSummary = {
  execution: {
    profile: HarnessExecutionProfile;
    roleAssignments: { generator: string; evaluator: string } | null;
  };
  autonomy: {
    enabled: boolean;
    expiresAt: string | null;
  };
};

export type HarnessDetailModes = {
  execution: HarnessExecutionProfile | "unknown";
  autonomy: {
    enabled: boolean;
    policyValid: boolean | null;
    authorizedBy: string | null;
    expiresAt: string | null;
    status: string | null;
  };
  dispatch: {
    enabled: boolean;
    assignments: Record<string, string>;
    agents: HarnessDetailAgent[];
    familyExclusive: boolean | null;
    issues: string[];
    agentSnapshotUsable: boolean;
  };
  framework: {
    version: string | null;
    adopted: boolean;
    managedCount: number | null;
    drift: { ok: number; modified: number; missing: number; customized: number } | null;
  } | null;
  gate: { pubInstalled: boolean | null; guardMode: string | null };
  machinery: { denyListMerged: boolean | null; hooks: string[]; missing: string[] };
  pendingDefaults: (HarnessDesiredSummary & {
    intentId: string;
    stagedAt: string;
    intentExpiresAt: string;
  }) | null;
};

function executionProfile(value: unknown): HarnessExecutionProfile | null {
  return HARNESS_EXECUTION_PROFILES.find((profile) => profile === value) ?? null;
}

function harnessTransport(value: unknown): HarnessTransport | null {
  return HARNESS_TRANSPORTS.find((transport) => transport === value) ?? null;
}

function roleAssignments(value: unknown): HarnessDesiredSummary["execution"]["roleAssignments"] {
  const assignments = record(value);
  const generator = text(assignments?.generator);
  const evaluator = text(assignments?.evaluator);
  if (!generator || !evaluator) return null;
  return { generator, evaluator };
}

function displayAgent(value: unknown): HarnessDetailAgent | null {
  const agent = record(value);
  const id = text(agent?.id);
  if (!agent || !id) return null;
  return {
    id,
    roles: stringList(agent.roles, 8),
    capabilities: stringList(agent.capabilities, 32),
    modelFamily: text(agent.modelFamily),
    transport: text(agent.transport) ?? "",
    adapter: text(agent.adapter),
    sandboxed: typeof agent.sandboxed === "boolean" ? agent.sandboxed : null
  };
}

function strictAgentSnapshot(dispatch: UnknownRecord | null): HarnessDetailAgent[] | null {
  if (dispatch?.enabled !== true || !Array.isArray(dispatch.agents)) return null;
  if (dispatch.agents.length < 1 || dispatch.agents.length > 50) return null;
  const seen = new Set<string>();
  const agents: HarnessDetailAgent[] = [];
  for (const value of dispatch.agents) {
    const agent = record(value);
    const parsed = displayAgent(value);
    if (!agent || !parsed || parsed.id.length > 128 || seen.has(parsed.id)) return null;
    if (
      !Array.isArray(agent.roles) ||
      agent.roles.length < 1 ||
      agent.roles.length > 8 ||
      parsed.roles.length !== agent.roles.length ||
      parsed.roles.some((role) => role.length > 32) ||
      !harnessTransport(parsed.transport) ||
      !parsed.modelFamily ||
      parsed.modelFamily.length > 128
    ) return null;
    seen.add(parsed.id);
    agents.push(parsed);
  }
  return agents;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function parsePendingDefaults(value: unknown): HarnessDetailModes["pendingDefaults"] {
  const pending = record(value);
  const execution = record(pending?.execution);
  const autonomy = record(pending?.autonomy);
  const profile = executionProfile(execution?.profile);
  const intentId = text(pending?.intentId);
  const stagedAt = text(pending?.stagedAt);
  const intentExpiresAt = text(pending?.intentExpiresAt);
  if (!pending || !execution || !autonomy || !profile || !intentId || !stagedAt || !intentExpiresAt) return null;
  if (typeof autonomy.enabled !== "boolean") return null;
  const assignments = profile === "fast" ? null : roleAssignments(execution.roleAssignments);
  if (profile !== "fast" && !assignments) return null;
  return {
    intentId,
    stagedAt,
    intentExpiresAt,
    execution: { profile, roleAssignments: assignments },
    autonomy: {
      enabled: autonomy.enabled,
      expiresAt: autonomy.enabled ? text(autonomy.expiresAt) : null
    }
  };
}

export function parseHarnessDetailModes(value: unknown): HarnessDetailModes | null {
  const modes = record(value);
  if (!modes) return null;
  const autonomy = record(modes.autonomy);
  const dispatch = record(modes.dispatch);
  const framework = record(modes.framework);
  const drift = record(framework?.drift);
  const gate = record(modes.gate);
  const machinery = record(modes.machinery);
  const strictAgents = strictAgentSnapshot(dispatch);
  const assignments: Record<string, string> = {};
  for (const [role, agentId] of Object.entries(record(dispatch?.assignments) ?? {})) {
    const normalized = text(agentId);
    if (normalized) assignments[role] = normalized;
  }
  const agents = Array.isArray(dispatch?.agents)
    ? dispatch.agents.slice(0, 50).map(displayAgent).filter((agent): agent is HarnessDetailAgent => agent !== null)
    : [];

  return {
    execution: executionProfile(modes.execution) ?? "unknown",
    autonomy: {
      enabled: autonomy?.enabled === true,
      policyValid: typeof autonomy?.policyValid === "boolean" ? autonomy.policyValid : null,
      authorizedBy: text(autonomy?.authorizedBy),
      expiresAt: text(autonomy?.expiresAt),
      status: text(autonomy?.status)
    },
    dispatch: {
      enabled: dispatch?.enabled === true,
      assignments,
      agents,
      familyExclusive: typeof dispatch?.familyExclusive === "boolean" ? dispatch.familyExclusive : null,
      issues: stringList(dispatch?.issues),
      agentSnapshotUsable: strictAgents !== null
    },
    framework: framework ? {
      version: text(framework.version),
      adopted: framework.adopted === true,
      managedCount: count(framework.managedCount),
      drift: drift ? {
        ok: count(drift.ok) ?? 0,
        modified: count(drift.modified) ?? 0,
        missing: count(drift.missing) ?? 0,
        customized: count(drift.customized) ?? 0
      } : null
    } : null,
    gate: {
      pubInstalled: typeof gate?.pubInstalled === "boolean" ? gate.pubInstalled : null,
      guardMode: text(gate?.guardMode)
    },
    machinery: {
      denyListMerged: typeof machinery?.denyListMerged === "boolean" ? machinery.denyListMerged : null,
      hooks: stringList(machinery?.hooks),
      missing: stringList(machinery?.missing)
    },
    pendingDefaults: parsePendingDefaults(modes.pendingDefaults)
  };
}

export function currentHarnessModeSummary(modes: HarnessDetailModes | null): HarnessDesiredSummary | null {
  if (!modes || modes.execution === "unknown") return null;
  const generator = modes.dispatch.assignments.generator;
  const evaluator = modes.dispatch.assignments.evaluator;
  return {
    execution: {
      profile: modes.execution,
      roleAssignments: modes.execution === "fast" || !generator || !evaluator ? null : { generator, evaluator }
    },
    autonomy: { enabled: modes.autonomy.enabled, expiresAt: modes.autonomy.expiresAt }
  };
}

export type HarnessModeIssuanceBlocker =
  | "signingKeyUnavailable"
  | "reportStale"
  | "agentUpgradeRequired"
  | "headNotFull"
  | "agentSnapshotUnavailable";

export function modeIssuanceBlocker(input: {
  signingKeyReady: boolean;
  reportedAt: Date | string | null;
  agentFeatureVersion: number | null;
  headSha: string | null;
  modes: HarnessDetailModes | null;
  now: Date | number;
}): HarnessModeIssuanceBlocker | null {
  if (!input.signingKeyReady) return "signingKeyUnavailable";
  const now = input.now instanceof Date ? input.now.getTime() : input.now;
  const reportedAt = input.reportedAt ? new Date(input.reportedAt).getTime() : Number.NaN;
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(reportedAt) ||
    reportedAt > now + 5 * 60 * 1000 ||
    now - reportedAt >= DEVICE_ONLINE_MS
  ) return "reportStale";
  if ((input.agentFeatureVersion ?? 0) < 4) return "agentUpgradeRequired";
  if (!input.headSha || !/^[0-9a-fA-F]{40}$/.test(input.headSha)) return "headNotFull";
  if (!input.modes?.dispatch.agentSnapshotUsable) return "agentSnapshotUnavailable";
  return null;
}

export type HarnessModeEditorDraft = {
  profile: string;
  generatorId: string;
  evaluatorId: string;
  intentExpiresAt: string;
  autonomyEnabled: boolean;
  autonomyExpiresAt: string;
  maxTokens: string | number;
  maxCostUsd: string | number;
  maxWakes: string | number;
  maxFixRounds: string | number;
  autoCross: HarnessAutonomyGate[];
  notifyOn: HarnessAutonomyNotification[];
};

export class HarnessModeEditorValidationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "HarnessModeEditorValidationError";
    this.code = code;
  }
}

function editorReject(code: string): never {
  throw new HarnessModeEditorValidationError(code);
}

function timestampInput(value: string): string {
  if (value.endsWith("Z")) return value;
  const epoch = new Date(value).getTime();
  return Number.isFinite(epoch) ? new Date(epoch).toISOString() : value;
}

function numericInput(value: string | number): number {
  return typeof value === "string" && !value.trim() ? Number.NaN : Number(value);
}

function modeAgentDescriptors(agents: readonly HarnessDetailAgent[]): HarnessModeAgentDescriptor[] {
  return agents.map((agent) => {
    const transport = harnessTransport(agent.transport);
    if (!transport) return editorReject("invalid_transport");
    return {
      id: agent.id,
      roles: agent.roles,
      transport,
      model_family: agent.modelFamily ?? ""
    };
  });
}

export function buildModeIntentRequest(
  projectId: string,
  draft: HarnessModeEditorDraft,
  agents: readonly HarnessDetailAgent[],
  now: Date
): { projectId: string; desired: HarnessModeIntentDesired; intentExpiresAt: string } {
  if (!projectId.trim()) return editorReject("invalid_project");
  const profile = executionProfile(draft.profile);
  if (!profile) return editorReject("invalid_profile");

  const intentExpiresAt = timestampInput(draft.intentExpiresAt);
  const desired: HarnessModeIntentDesired = {
    execution: profile === "fast"
      ? { profile: "fast", role_assignments: null }
      : {
          profile,
          role_assignments: { generator: draft.generatorId, evaluator: draft.evaluatorId }
        },
    autonomy: draft.autonomyEnabled
      ? {
          enabled: true,
          expires_at: timestampInput(draft.autonomyExpiresAt),
          auto_cross: draft.autoCross,
          budget: {
            max_tokens: numericInput(draft.maxTokens),
            max_cost_usd: numericInput(draft.maxCostUsd),
            max_wakes: numericInput(draft.maxWakes),
            max_fix_rounds: numericInput(draft.maxFixRounds)
          },
          notify_on: draft.notifyOn
        }
      : { enabled: false }
  };

  try {
    const payload = normalizeHarnessModeIntentPayload(
      {
        intent_id: "client-validation",
        repo_key: "client-validation",
        expected_head_sha: "0".repeat(40),
        desired,
        issued_by: "client-validation",
        issued_at: now.toISOString(),
        intent_expires_at: intentExpiresAt
      },
      {
        now,
        agents: modeAgentDescriptors(agents)
      }
    );
    return { projectId: projectId.trim(), desired: payload.desired, intentExpiresAt };
  } catch (error) {
    if (error instanceof HarnessModeIntentValidationError) return editorReject(error.code);
    throw error;
  }
}

export { HARNESS_AUTONOMY_LIMITS };
