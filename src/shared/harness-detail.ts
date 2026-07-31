import {
  HARNESS_AUTONOMY_LIMITS,
  HARNESS_EXECUTION_PROFILES,
  HARNESS_MODE_ROLES,
  HARNESS_TRANSPORTS,
  HarnessModeIntentValidationError,
  normalizeHarnessModeIntentPayload,
  type HarnessAutonomyGate,
  type HarnessAutonomyNotification,
  type HarnessExecutionProfile,
  type HarnessModeIntentDesired,
  type HarnessModeRole,
  type HarnessTransport
} from "@/shared/harness-mode-intent";
import {
  toolCatalogModeDescriptors,
  type HarnessToolCatalogEntry,
  type HarnessToolIntegration
} from "@/shared/harness-tool-catalog";
import { DEVICE_ONLINE_MS } from "@/shared/device-status";
import {
  MIN_MODE_INTENT_AGENT_FEATURE_VERSION,
  MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION
} from "@/shared/agent-feature-version";

type UnknownRecord = Record<string, unknown>;
const TOOL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

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

export type HarnessDetailToolCapability = HarnessToolCatalogEntry;
export type HarnessDetailIntegration = HarnessToolIntegration;

export type HarnessDetailRoleBindings = {
  planner: ({ tool: string; invocation: HarnessTransport; modelFamily?: string } | null);
  generator: { tool: string; invocation: HarnessTransport; modelFamily?: string };
  evaluator: { tool: string; invocation: HarnessTransport; modelFamily?: string };
};

export type HarnessDetailResolvedRoleBindings = {
  planner: ({ tool: string; invocation: HarnessTransport; modelFamily: string } | null);
  generator: { tool: string; invocation: HarnessTransport; modelFamily: string };
  evaluator: { tool: string; invocation: HarnessTransport; modelFamily: string };
};

export type HarnessDesiredSummary = {
  execution: {
    profile: HarnessExecutionProfile;
    roleAssignments: { generator: string; evaluator: string } | null;
    roleBindings: HarnessDetailRoleBindings | null;
  };
  autonomy: {
    enabled: boolean;
    expiresAt: string | null;
  };
};

export type HarnessDetailModes = {
  execution: HarnessExecutionProfile | "unknown";
  current: {
    profile: "heterogeneous" | "slow";
    roleBindings: HarnessDetailResolvedRoleBindings;
  } | null;
  autonomy: {
    enabled: boolean;
    policyValid: boolean | null;
    authorizedBy: string | null;
    expiresAt: string | null;
    status: string | null;
  };
  dispatch: {
    enabled: boolean;
    assignments: Record<string, string | null>;
    agents: HarnessDetailAgent[];
    integrations: HarnessDetailIntegration[];
    toolCatalog: HarnessDetailToolCapability[];
    familyExclusive: boolean | null;
    issues: string[];
    agentSnapshotUsable: boolean;
    integrationSnapshotUsable: boolean;
    toolCatalogUsable: boolean;
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

function roleBindings(value: unknown): HarnessDetailRoleBindings | null {
  const bindings = record(value);
  if (!bindings) return null;
  const parsed = {} as HarnessDetailRoleBindings;
  for (const role of HARNESS_MODE_ROLES) {
    if (role === "planner" && bindings[role] === null) {
      parsed.planner = null;
      continue;
    }
    const binding = record(bindings[role]);
    const tool = text(binding?.tool);
    const invocation = harnessTransport(binding?.invocation);
    if (!binding || !tool || !invocation) return null;
    parsed[role] = { tool, invocation };
  }
  return parsed;
}

function currentMode(value: unknown, execution: HarnessDetailModes["execution"]): HarnessDetailModes["current"] {
  const current = record(value);
  const profile = executionProfile(current?.profile);
  const bindings = record(current?.roleBindings);
  if (!current || (profile !== "heterogeneous" && profile !== "slow") || profile !== execution || !bindings) return null;

  const parsed = {} as HarnessDetailResolvedRoleBindings;
  for (const role of HARNESS_MODE_ROLES) {
    if (role === "planner" && bindings[role] === null) {
      parsed.planner = null;
      continue;
    }
    const binding = record(bindings[role]);
    const tool = text(binding?.tool);
    const invocation = harnessTransport(binding?.invocation);
    const modelFamily = text(binding?.modelFamily);
    if (!binding || !tool || tool.length > 64 || !invocation || !modelFamily || modelFamily.length > 128) return null;
    parsed[role] = { tool, invocation, modelFamily };
  }
  const invocations = HARNESS_MODE_ROLES.flatMap((role) => {
    const binding = parsed[role];
    return binding === null ? [] : [binding.invocation];
  });
  if (
    (profile === "slow" && !invocations.includes("a2a")) ||
    (profile === "heterogeneous" && (invocations.includes("a2a") || !invocations.includes("local-cli")))
  ) return null;
  return { profile, roleBindings: parsed };
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

function displayIntegration(value: unknown): HarnessDetailIntegration | null {
  const integration = record(value);
  const id = text(integration?.id);
  const tool = text(integration?.tool);
  const label = text(integration?.label);
  const modelFamily = text(integration?.modelFamily);
  if (!integration || !id || !tool || !label || !modelFamily) return null;
  return {
    id,
    tool,
    label,
    modelFamily,
    roles: stringList(integration.roles, 8).filter((role): role is HarnessModeRole =>
      HARNESS_MODE_ROLES.includes(role as HarnessModeRole)
    ),
    invocations: stringList(integration.invocations, 8).flatMap((invocation) => {
      const parsed = harnessTransport(invocation);
      return parsed ? [parsed] : [];
    }),
    capabilities: stringList(integration.capabilities, 64),
    localCli: integration.localCli === true,
    subagent: integration.subagent === true,
    a2aTargetCount: count(integration.a2aTargetCount) ?? -1,
    sandboxed: integration.sandboxed === true
  };
}

/** Keep already-persisted dispatch/1 reports readable after the UI migration. */
function integrationFromLegacyAgent(agent: HarnessDetailAgent): HarnessDetailIntegration | null {
  const invocation = harnessTransport(agent.transport);
  const roles = agent.roles.filter((role): role is HarnessModeRole =>
    HARNESS_MODE_ROLES.includes(role as HarnessModeRole)
  );
  if (!invocation || roles.length === 0) return null;
  const tool = agent.adapter ?? agent.id;
  return {
    id: agent.id,
    tool,
    label: agent.id,
    modelFamily: agent.modelFamily ?? "unknown",
    roles,
    invocations: [invocation],
    capabilities: agent.capabilities,
    localCli: invocation === "local-cli",
    subagent: invocation === "subagent",
    a2aTargetCount: invocation === "a2a" ? 1 : 0,
    sandboxed: agent.sandboxed === true
  };
}

function strictIntegrationSnapshot(dispatch: UnknownRecord | null): HarnessDetailIntegration[] | null {
  if (dispatch?.enabled !== true || !Array.isArray(dispatch.integrations)) return null;
  if (dispatch.integrations.length < 1 || dispatch.integrations.length > 50) return null;
  const seen = new Set<string>();
  const integrations: HarnessDetailIntegration[] = [];
  for (const value of dispatch.integrations) {
    const integration = record(value);
    const parsed = displayIntegration(value);
    if (
      !integration || !parsed || !TOOL_ID.test(parsed.id) || seen.has(parsed.id) ||
      !TOOL_ID.test(parsed.tool) || parsed.label.length > 128 || parsed.modelFamily.length > 128 ||
      !Array.isArray(integration.roles) || integration.roles.length < 1 || integration.roles.length > 3 ||
      integration.roles.length !== parsed.roles.length || new Set(parsed.roles).size !== parsed.roles.length ||
      !Array.isArray(integration.invocations) || integration.invocations.length < 1 || integration.invocations.length > 3 ||
      integration.invocations.length !== parsed.invocations.length || new Set(parsed.invocations).size !== parsed.invocations.length ||
      !Array.isArray(integration.capabilities) || integration.capabilities.length !== parsed.capabilities.length ||
      new Set(parsed.capabilities).size !== parsed.capabilities.length || parsed.a2aTargetCount < 0 || parsed.a2aTargetCount > 100 ||
      typeof integration.localCli !== "boolean" || typeof integration.subagent !== "boolean" ||
      typeof integration.sandboxed !== "boolean" ||
      parsed.localCli !== parsed.invocations.includes("local-cli") ||
      (parsed.localCli && !parsed.sandboxed) || (!parsed.localCli && parsed.sandboxed) ||
      (parsed.subagent !== parsed.invocations.includes("subagent")) ||
      ((parsed.a2aTargetCount > 0) !== parsed.invocations.includes("a2a"))
    ) return null;
    seen.add(parsed.id);
    integrations.push(parsed);
  }
  return integrations;
}

function strictToolCatalog(dispatch: UnknownRecord | null): HarnessDetailToolCapability[] | null {
  if (!Array.isArray(dispatch?.toolCatalog) || dispatch.toolCatalog.length < 1 || dispatch.toolCatalog.length > 150) return null;
  const catalog: HarnessDetailToolCapability[] = [];
  const seen = new Set<string>();
  for (const value of dispatch.toolCatalog) {
    const capability = record(value);
    const tool = text(capability?.tool);
    const label = text(capability?.label);
    const invocation = harnessTransport(capability?.invocation);
    const role = text(capability?.role);
    const modelFamilies = stringList(capability?.modelFamilies, 50);
    const capabilities = stringList(capability?.capabilities, 64);
    const agentCount = capability?.agentCount;
    if (
      !capability ||
      !tool ||
      tool.length > 64 ||
      !label ||
      label.length > 128 ||
      !invocation ||
      !role ||
      !HARNESS_MODE_ROLES.includes(role as HarnessModeRole) ||
      !Array.isArray(capability.modelFamilies) ||
      capability.modelFamilies.length < 1 ||
      capability.modelFamilies.length !== modelFamilies.length ||
      new Set(modelFamilies).size !== modelFamilies.length ||
      modelFamilies.some((family) => family.length > 128) ||
      !Array.isArray(capability.capabilities) ||
      capability.capabilities.length !== capabilities.length ||
      new Set(capabilities).size !== capabilities.length ||
      typeof agentCount !== "number" ||
      !Number.isSafeInteger(agentCount) ||
      agentCount < 1 ||
      agentCount > 50
    ) {
      return null;
    }
    const key = `${role}\u0000${tool}\u0000${invocation}`;
    if (seen.has(key)) return null;
    seen.add(key);
    catalog.push({ tool, label, invocation, role: role as HarnessModeRole, agentCount, modelFamilies, capabilities });
  }
  return HARNESS_MODE_ROLES.every((role) => catalog.some((entry) => entry.role === role)) ? catalog : null;
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
  const assignments = roleAssignments(execution.roleAssignments);
  const bindings = roleBindings(execution.roleBindings);
  if (profile === "fast" && (assignments || bindings)) return null;
  if (profile !== "fast" && Boolean(assignments) === Boolean(bindings)) return null;
  return {
    intentId,
    stagedAt,
    intentExpiresAt,
    execution: { profile, roleAssignments: assignments, roleBindings: bindings },
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
  const strictIntegrations = strictIntegrationSnapshot(dispatch);
  const strictTools = strictToolCatalog(dispatch);
  const assignments: Record<string, string | null> = {};
  for (const [role, agentId] of Object.entries(record(dispatch?.assignments) ?? {})) {
    if (role === "planner" && agentId === null) {
      assignments.planner = null;
      continue;
    }
    const normalized = text(agentId);
    if (normalized) assignments[role] = normalized;
  }
  const agents = Array.isArray(dispatch?.agents)
    ? dispatch.agents.slice(0, 50).map(displayAgent).filter((agent): agent is HarnessDetailAgent => agent !== null)
    : [];
  const reportedIntegrations = Array.isArray(dispatch?.integrations)
    ? dispatch.integrations.slice(0, 50).map(displayIntegration).filter((item): item is HarnessDetailIntegration => item !== null)
    : [];
  const integrations = reportedIntegrations.length > 0
    ? reportedIntegrations
    : agents.map(integrationFromLegacyAgent).filter((item): item is HarnessDetailIntegration => item !== null);

  const execution = executionProfile(modes.execution) ?? "unknown";
  return {
    execution,
    current: currentMode(modes.current, execution),
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
      integrations,
      toolCatalog: strictTools ?? [],
      familyExclusive: typeof dispatch?.familyExclusive === "boolean" ? dispatch.familyExclusive : null,
      issues: stringList(dispatch?.issues),
      agentSnapshotUsable: strictAgents !== null || strictIntegrations !== null,
      integrationSnapshotUsable: strictIntegrations !== null,
      toolCatalogUsable: strictTools !== null
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
  if (modes.current?.profile === modes.execution) {
    return {
      execution: {
        profile: modes.current.profile,
        roleAssignments: null,
        roleBindings: modes.current.roleBindings
      },
      autonomy: { enabled: modes.autonomy.enabled, expiresAt: modes.autonomy.expiresAt }
    };
  }
  const generator = modes.dispatch.assignments.generator;
  const evaluator = modes.dispatch.assignments.evaluator;
  return {
    execution: {
      profile: modes.execution,
      roleAssignments: modes.execution === "fast" || !generator || !evaluator ? null : { generator, evaluator },
      roleBindings: null
    },
    autonomy: { enabled: modes.autonomy.enabled, expiresAt: modes.autonomy.expiresAt }
  };
}

export type HarnessModeIssuanceBlocker =
  | "signingKeyUnavailable"
  | "reportStale"
  | "agentUpgradeRequired"
  | "toolBindingAgentUpgradeRequired"
  | "headNotFull"
  | "agentSnapshotUnavailable"
  | "toolCatalogUnavailable";

export function modeIssuanceBlocker(input: {
  signingKeyReady: boolean;
  reportedAt: Date | string | null;
  agentFeatureVersion: number | null;
  headSha: string | null;
  modes: HarnessDetailModes | null;
  now: Date | number;
  requiresToolBindings?: boolean;
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
  if ((input.agentFeatureVersion ?? 0) < MIN_MODE_INTENT_AGENT_FEATURE_VERSION) return "agentUpgradeRequired";
  if (
    input.requiresToolBindings === true &&
    (input.agentFeatureVersion ?? 0) < MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION
  ) return "toolBindingAgentUpgradeRequired";
  if (!input.headSha || !/^[0-9a-fA-F]{40}$/.test(input.headSha)) return "headNotFull";
  if (!input.modes) return "agentSnapshotUnavailable";
  if (!input.modes.dispatch.agentSnapshotUsable) return "agentSnapshotUnavailable";
  if (input.requiresToolBindings === true && !input.modes.dispatch.toolCatalogUsable) return "toolCatalogUnavailable";
  return null;
}

export type HarnessModeEditorDraft = {
  profile: string;
  plannerTool: string;
  plannerInvocation: string;
  generatorTool: string;
  generatorInvocation: string;
  evaluatorTool: string;
  evaluatorInvocation: string;
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

export function buildModeIntentRequest(
  projectId: string,
  draft: HarnessModeEditorDraft,
  tools: readonly HarnessDetailToolCapability[],
  now: Date,
  options: { useToolBindings?: boolean } = {}
): { projectId: string; desired: HarnessModeIntentDesired; intentExpiresAt: string } {
  if (!projectId.trim()) return editorReject("invalid_project");
  const profile = executionProfile(draft.profile);
  if (!profile) return editorReject("invalid_profile");

  const intentExpiresAt = timestampInput(draft.intentExpiresAt);
  const plannerTool = draft.plannerTool.trim();
  const plannerInvocation = draft.plannerInvocation.trim();
  const desired: HarnessModeIntentDesired = {
    execution: profile === "fast"
      ? options.useToolBindings
        ? { profile: "fast", role_bindings: null }
        : { profile: "fast", role_assignments: null }
      : {
          profile,
          role_bindings: {
            planner: !plannerTool && !plannerInvocation
              ? null
              : { tool: draft.plannerTool, invocation: draft.plannerInvocation as HarnessTransport },
            generator: { tool: draft.generatorTool, invocation: draft.generatorInvocation as HarnessTransport },
            evaluator: { tool: draft.evaluatorTool, invocation: draft.evaluatorInvocation as HarnessTransport }
          }
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
        tools: toolCatalogModeDescriptors(tools)
      }
    );
    return { projectId: projectId.trim(), desired: payload.desired, intentExpiresAt };
  } catch (error) {
    if (error instanceof HarnessModeIntentValidationError) return editorReject(error.code);
    throw error;
  }
}

export { HARNESS_AUTONOMY_LIMITS };
