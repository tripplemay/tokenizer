export const HARNESS_EXECUTION_PROFILES = ["fast", "heterogeneous", "slow"] as const;
export const HARNESS_TRANSPORTS = ["subagent", "local-cli", "a2a"] as const;
export const HARNESS_MODE_ROLES = ["planner", "generator", "evaluator"] as const;
export const HARNESS_MODE_INTENT_STATUSES = [
  "issued",
  "relayed",
  "staged",
  "applied",
  "failed",
  "superseded",
  "expired"
] as const;
export const HARNESS_AUTONOMY_GATES = ["A", "B"] as const;
export const HARNESS_AUTONOMY_NOTIFICATIONS = [
  "halt",
  "done",
  "budget_80pct",
  "scope_drift",
  "ci_red"
] as const;

export const HARNESS_AUTONOMY_LIMITS = {
  maxTokens: { min: 0, max: 10_000_000 },
  maxCostUsd: { min: 0, max: 10_000 },
  maxWakes: { min: 1, max: 1_000 },
  maxFixRounds: { min: 0, max: 5 },
  wakeIntervalSeconds: { min: 60, max: 86_400 }
} as const;

export type HarnessExecutionProfile = (typeof HARNESS_EXECUTION_PROFILES)[number];
export type HarnessTransport = (typeof HARNESS_TRANSPORTS)[number];
export type HarnessModeIntentStatus = (typeof HARNESS_MODE_INTENT_STATUSES)[number];
export type HarnessAutonomyGate = (typeof HARNESS_AUTONOMY_GATES)[number];
export type HarnessAutonomyNotification = (typeof HARNESS_AUTONOMY_NOTIFICATIONS)[number];
export type HarnessModeRole = (typeof HARNESS_MODE_ROLES)[number];
export type HarnessModeAssignmentRole = Exclude<HarnessModeRole, "planner">;

export type HarnessModeRoleAssignments = {
  generator: string;
  evaluator: string;
};

export type HarnessModeRoleBinding = {
  tool: string;
  invocation: HarnessTransport;
};

export type HarnessModeRoleBindings = {
  /** null delegates planning to the harness Coordinator. */
  planner: HarnessModeRoleBinding | null;
  generator: HarnessModeRoleBinding;
  evaluator: HarnessModeRoleBinding;
};

export type HarnessModeExecution =
  | { profile: "fast"; role_assignments: null }
  | { profile: "fast"; role_bindings: null }
  | {
      profile: "heterogeneous" | "slow";
      role_assignments: HarnessModeRoleAssignments;
    }
  | {
      profile: "heterogeneous" | "slow";
      role_bindings: HarnessModeRoleBindings;
    };

export type HarnessAutonomyBudget = {
  max_tokens: number;
  max_cost_usd: number;
  max_wakes: number;
  max_fix_rounds: number;
};

export type HarnessAutonomyDisabled = { enabled: false };

export type HarnessAutonomyEnabled = {
  enabled: true;
  expires_at: string;
  auto_cross: HarnessAutonomyGate[];
  budget: HarnessAutonomyBudget;
  wake_interval_s?: Record<string, number>;
  notify_on?: HarnessAutonomyNotification[];
};

export type HarnessModeAutonomy = HarnessAutonomyDisabled | HarnessAutonomyEnabled;

export type HarnessModeIntentDesired = {
  execution: HarnessModeExecution;
  autonomy: HarnessModeAutonomy;
};

/** Exact canonical payload signed by the console. `sig` is deliberately not part of it. */
export type HarnessModeIntentPayload = {
  intent_id: string;
  repo_key: string;
  expected_head_sha: string;
  desired: HarnessModeIntentDesired;
  issued_by: string;
  issued_at: string;
  intent_expires_at: string;
};

export type HarnessSignedModeIntent = HarnessModeIntentPayload & { sig: string };

/** The subset of a dispatch descriptor required to validate signed assignments. */
export type HarnessModeAgentDescriptor = {
  id: string;
  roles: readonly string[];
  transport: HarnessTransport;
  model_family: string;
};

/**
 * A role-specific tool capability advertised by the local device. It has no
 * agent id: the local resolver owns selection of a concrete registered agent.
 */
export type HarnessModeToolDescriptor = {
  tool: string;
  invocation: HarnessTransport;
  role: HarnessModeRole;
  model_family: string;
};

export type HarnessModeIntentValidationContext = {
  /** Explicit clock input keeps validation deterministic and side-effect free. */
  now: Date | string | number;
  agents?: readonly HarnessModeAgentDescriptor[];
  tools?: readonly HarnessModeToolDescriptor[];
};

export type HarnessModeIntentValidationIssue = {
  code: string;
  path: string;
  message: string;
};

export type HarnessModeIntentValidationResult =
  | { ok: true; value: HarnessModeIntentPayload }
  | { ok: false; error: HarnessModeIntentValidationIssue };

export class HarnessModeIntentValidationError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(message);
    this.name = "HarnessModeIntentValidationError";
    this.code = code;
    this.path = path;
  }

  toIssue(): HarnessModeIntentValidationIssue {
    return { code: this.code, path: this.path, message: this.message };
  }
}

type UnknownRecord = Record<string, unknown>;

const UTC_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/;
const HEAD_SHA_PATTERN = /^[0-9a-fA-F]{40}$/;
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RESERVED_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const EXECUTION_PROFILES = new Set<string>(HARNESS_EXECUTION_PROFILES);
const TRANSPORTS = new Set<string>(HARNESS_TRANSPORTS);
const MODE_ROLES = new Set<string>(HARNESS_MODE_ROLES);
const AUTONOMY_GATES = new Set<string>(HARNESS_AUTONOMY_GATES);
const AUTONOMY_NOTIFICATIONS = new Set<string>(HARNESS_AUTONOMY_NOTIFICATIONS);

function reject(code: string, path: string, message: string): never {
  throw new HarnessModeIntentValidationError(code, path, message);
}

function plainObject(value: unknown, path: string): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return reject("invalid_type", path, `${path} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return reject("invalid_type", path, `${path} must be a plain object`);
  }
  return value as UnknownRecord;
}

function exactObject(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = []
): UnknownRecord {
  const record = plainObject(value, path);
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(record);
  const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(record, key));
  if (missing.length > 0) {
    return reject("missing_key", path, `${path} is missing required keys: ${missing.join(", ")}`);
  }
  const extra = keys.filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    return reject("extra_key", path, `${path} contains unsupported keys: ${extra.join(", ")}`);
  }
  return record;
}

function nonBlankString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    return reject("invalid_string", path, `${path} must be a non-blank string`);
  }
  return value.trim();
}

function boundedInteger(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    return reject("invalid_number", path, `${path} must be a safe integer between ${min} and ${max}`);
  }
  return value;
}

/**
 * Signed JSON must stay within the decimal representation shared by Node and
 * the framework's Python validator. Normalize valid USD amounts to cents and
 * reject values that would need rounding (including -0 and tiny exponents).
 */
function boundedUsdCents(value: unknown, path: string, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Object.is(value, -0) ||
    value < min ||
    value > max ||
    Number(value.toFixed(2)) !== value
  ) {
    return reject("invalid_number", path, `${path} must be a non-negative finite USD amount with at most two decimal places between ${min} and ${max}`);
  }
  return Number(value.toFixed(2));
}

function stableAsciiId(value: unknown, path: string): string {
  if (typeof value !== "string" || !STABLE_ID_PATTERN.test(value) || RESERVED_OBJECT_KEYS.has(value)) {
    return reject("invalid_string", path, `${path} must be a stable ASCII identifier`);
  }
  return value;
}

function timestampEpoch(value: unknown, path: string): number {
  if (typeof value !== "string") {
    return reject("invalid_timestamp", path, `${path} must be an absolute ISO-8601 UTC timestamp`);
  }
  const match = UTC_TIMESTAMP_PATTERN.exec(value);
  if (!match) {
    return reject("invalid_timestamp", path, `${path} must use YYYY-MM-DDTHH:mm:ss(.sss)Z`);
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = ""] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > monthDays[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return reject("invalid_timestamp", path, `${path} is not a valid calendar timestamp`);
  }

  const milliseconds = Number((fraction + "000").slice(0, 3));
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, milliseconds);
  const epoch = date.getTime();
  if (!Number.isFinite(epoch)) {
    return reject("invalid_timestamp", path, `${path} is outside the supported timestamp range`);
  }
  return epoch;
}

function contextNowEpoch(now: HarnessModeIntentValidationContext["now"]): number {
  if (now instanceof Date) {
    const epoch = now.getTime();
    if (Number.isFinite(epoch)) return epoch;
  } else if (typeof now === "number" && Number.isFinite(now)) {
    return now;
  } else if (typeof now === "string") {
    return timestampEpoch(now, "context.now");
  }
  return reject("invalid_timestamp", "context.now", "context.now must be a valid Date, epoch, or UTC timestamp");
}

/** Matches the normalization performed by harness v1.5.0 before repo identity comparison. */
export function normalizeHarnessRepoKey(value: unknown): string {
  let normalized = nonBlankString(value, "repo_key");
  normalized = normalized.replace(/^ssh:\/\/git@/i, "");
  normalized = normalized.replace(/^git@([^:]+):/i, "$1/");
  normalized = normalized.replace(/^https?:\/\//i, "");
  normalized = normalized.replace(/^git:\/\//i, "");
  normalized = normalized.replace(/\.git$/i, "");
  normalized = normalized.toLowerCase();
  if (normalized === "") {
    return reject("invalid_string", "repo_key", "repo_key must identify a repository");
  }
  return normalized;
}

function normalizedProfile(value: unknown): HarnessExecutionProfile {
  if (typeof value !== "string" || !EXECUTION_PROFILES.has(value)) {
    return reject("invalid_profile", "desired.execution.profile", "execution profile must be fast, heterogeneous, or slow");
  }
  return value as HarnessExecutionProfile;
}

function validateProfileTransports(profile: Exclude<HarnessExecutionProfile, "fast">, transports: readonly HarnessTransport[]): void {
  if (profile === "heterogeneous" && (transports.includes("a2a") || !transports.includes("local-cli"))) {
    return reject(
      "profile_transport_mismatch",
      "desired.execution.profile",
      "heterogeneous profile forbids a2a and requires at least one local-cli tool"
    );
  }
  if (profile === "slow" && !transports.includes("a2a")) {
    return reject(
      "profile_transport_mismatch",
      "desired.execution.profile",
      "slow profile requires at least one a2a tool"
    );
  }
}

function normalizeLegacyExecution(
  value: unknown,
  agents: readonly HarnessModeAgentDescriptor[] | undefined
): HarnessModeExecution {
  const execution = exactObject(value, "desired.execution", ["profile", "role_assignments"]);
  const profile = normalizedProfile(execution.profile);
  if (profile === "fast") {
    if (execution.role_assignments !== null) {
      return reject(
        "invalid_assignments",
        "desired.execution.role_assignments",
        "fast profile requires null role_assignments"
      );
    }
    return { profile, role_assignments: null };
  }

  const assignmentsValue = exactObject(
    execution.role_assignments,
    "desired.execution.role_assignments",
    ["generator", "evaluator"]
  );
  const assignments: HarnessModeRoleAssignments = {
    generator: nonBlankString(assignmentsValue.generator, "desired.execution.role_assignments.generator"),
    evaluator: nonBlankString(assignmentsValue.evaluator, "desired.execution.role_assignments.evaluator")
  };
  if (assignments.generator === assignments.evaluator) {
    return reject("duplicate_agent", "desired.execution.role_assignments", "generator and evaluator must use distinct agents");
  }
  if (!agents) {
    return reject("missing_agents", "context.agents", `${profile} profile requires the agent registry snapshot`);
  }

  const byId = new Map<string, HarnessModeAgentDescriptor>();
  for (const descriptor of agents) {
    const id = nonBlankString(descriptor?.id, "context.agents[].id");
    if (byId.has(id)) {
      return reject("duplicate_agent", "context.agents", `agent registry contains duplicate id ${id}`);
    }
    byId.set(id, descriptor);
  }

  const descriptors = {} as Record<HarnessModeAssignmentRole, HarnessModeAgentDescriptor>;
  const modelFamilies = {} as Record<HarnessModeAssignmentRole, string>;
  for (const role of ["generator", "evaluator"] as const) {
    const descriptor = byId.get(assignments[role]);
    if (!descriptor) {
      return reject("unknown_agent", `desired.execution.role_assignments.${role}`, `agent ${assignments[role]} does not exist`);
    }
    if (!Array.isArray(descriptor.roles) || !descriptor.roles.includes(role)) {
      return reject("role_not_allowed", `desired.execution.role_assignments.${role}`, `agent ${descriptor.id} does not allow role ${role}`);
    }
    modelFamilies[role] = nonBlankString(descriptor.model_family, `context.agents.${descriptor.id}.model_family`);
    if (typeof descriptor.transport !== "string" || !TRANSPORTS.has(descriptor.transport)) {
      return reject("invalid_transport", `context.agents.${descriptor.id}.transport`, `agent ${descriptor.id} has an invalid transport`);
    }
    descriptors[role] = descriptor;
  }

  if (modelFamilies.generator === modelFamilies.evaluator) {
    return reject(
      "same_model_family",
      "desired.execution.role_assignments",
      "generator and evaluator must use distinct model families"
    );
  }
  validateProfileTransports(profile, [descriptors.generator.transport, descriptors.evaluator.transport]);
  return { profile, role_assignments: assignments };
}

function normalizeToolBindingExecution(
  value: unknown,
  tools: readonly HarnessModeToolDescriptor[] | undefined
): HarnessModeExecution {
  const execution = exactObject(value, "desired.execution", ["profile", "role_bindings"]);
  const profile = normalizedProfile(execution.profile);
  if (profile === "fast") {
    if (execution.role_bindings !== null) {
      return reject("invalid_bindings", "desired.execution.role_bindings", "fast profile requires null role_bindings");
    }
    return { profile, role_bindings: null };
  }
  if (!tools) {
    return reject("missing_tool_catalog", "context.tools", `${profile} profile requires the reported tool catalog`);
  }

  const bindingsValue = exactObject(
    execution.role_bindings,
    "desired.execution.role_bindings",
    ["planner", "generator", "evaluator"]
  );
  const bindings = {} as HarnessModeRoleBindings;
  for (const role of HARNESS_MODE_ROLES) {
    if (role === "planner" && bindingsValue[role] === null) {
      bindings.planner = null;
      continue;
    }
    const binding = exactObject(bindingsValue[role], `desired.execution.role_bindings.${role}`, ["tool", "invocation"]);
    const invocation = nonBlankString(binding.invocation, `desired.execution.role_bindings.${role}.invocation`);
    if (!TRANSPORTS.has(invocation)) {
      return reject("invalid_transport", `desired.execution.role_bindings.${role}.invocation`, "tool invocation is not recognized");
    }
    bindings[role] = {
      tool: nonBlankString(binding.tool, `desired.execution.role_bindings.${role}.tool`),
      invocation: invocation as HarnessTransport
    };
  }

  const candidateFamilies = new Map<string, Set<string>>();
  for (const descriptor of tools) {
    const role = nonBlankString(descriptor?.role, "context.tools[].role");
    if (!MODE_ROLES.has(role)) {
      return reject("invalid_role", "context.tools[].role", `tool catalog role ${role} is not recognized`);
    }
    const tool = nonBlankString(descriptor.tool, "context.tools[].tool");
    const invocation = nonBlankString(descriptor.invocation, "context.tools[].invocation");
    if (!TRANSPORTS.has(invocation)) {
      return reject("invalid_transport", "context.tools[].invocation", "tool catalog has an invalid invocation");
    }
    const family = nonBlankString(descriptor.model_family, "context.tools[].model_family");
    const key = `${role}\u0000${tool}\u0000${invocation}`;
    const families = candidateFamilies.get(key) ?? new Set<string>();
    families.add(family);
    candidateFamilies.set(key, families);
  }

  const familiesFor = (role: HarnessModeRole): Set<string> => {
    const binding = bindings[role];
    if (binding === null) return new Set<string>();
    return candidateFamilies.get(`${role}\u0000${binding.tool}\u0000${binding.invocation}`) ?? new Set<string>();
  };
  for (const role of HARNESS_MODE_ROLES) {
    if (role === "planner" && bindings.planner === null) continue;
    const binding = bindings[role];
    if (binding === null) continue;
    if (familiesFor(role).size === 0) {
      return reject(
        "unknown_tool",
        `desired.execution.role_bindings.${role}`,
        `tool ${binding.tool} cannot be invoked as ${binding.invocation} for ${role}`
      );
    }
  }

  const generatorFamilies = familiesFor("generator");
  const evaluatorFamilies = familiesFor("evaluator");
  const hasIndependentPair = [...generatorFamilies].some((generator) =>
    [...evaluatorFamilies].some((evaluator) => generator !== evaluator)
  );
  if (!hasIndependentPair) {
    return reject(
      "same_model_family",
      "desired.execution.role_bindings",
      "generator and evaluator bindings do not have a viable distinct model-family pairing"
    );
  }

  validateProfileTransports(
    profile,
    HARNESS_MODE_ROLES.flatMap((role) => {
      const binding = bindings[role];
      return binding === null ? [] : [binding.invocation];
    })
  );
  return { profile, role_bindings: bindings };
}

function normalizeExecution(
  value: unknown,
  agents: readonly HarnessModeAgentDescriptor[] | undefined,
  tools: readonly HarnessModeToolDescriptor[] | undefined
): HarnessModeExecution {
  const execution = plainObject(value, "desired.execution");
  return Object.prototype.hasOwnProperty.call(execution, "role_bindings")
    ? normalizeToolBindingExecution(execution, tools)
    : normalizeLegacyExecution(execution, agents);
}

/** Identifies the v2 branch before full validation, for feature-gate selection. */
export function usesHarnessToolBindings(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const desired = value as UnknownRecord;
  const execution = desired.execution;
  return execution !== null && typeof execution === "object" && !Array.isArray(execution) &&
    Object.prototype.hasOwnProperty.call(execution, "role_bindings");
}

/**
 * A v2 fast intent still needs a v2-capable device, but it has no selected
 * tool to resolve and therefore must not require a reported tool catalog.
 */
export function requiresHarnessToolCatalog(value: unknown): boolean {
  if (!usesHarnessToolBindings(value)) return false;
  const execution = (value as UnknownRecord).execution as UnknownRecord;
  return execution.role_bindings !== null;
}

function normalizeAutonomy(value: unknown, nowEpoch: number): HarnessModeAutonomy {
  const base = exactObject(
    value,
    "desired.autonomy",
    ["enabled"],
    ["expires_at", "auto_cross", "budget", "wake_interval_s", "notify_on"]
  );
  if (typeof base.enabled !== "boolean") {
    return reject("invalid_type", "desired.autonomy.enabled", "autonomy.enabled must be boolean");
  }
  if (base.enabled === false) {
    exactObject(value, "desired.autonomy", ["enabled"]);
    return { enabled: false };
  }

  const autonomy = exactObject(
    value,
    "desired.autonomy",
    ["enabled", "expires_at", "auto_cross", "budget"],
    ["wake_interval_s", "notify_on"]
  );
  const expiryEpoch = timestampEpoch(autonomy.expires_at, "desired.autonomy.expires_at");
  if (expiryEpoch <= nowEpoch) {
    return reject("expired_autonomy", "desired.autonomy.expires_at", "autonomy expiry must be in the future");
  }

  if (!Array.isArray(autonomy.auto_cross)) {
    return reject("invalid_type", "desired.autonomy.auto_cross", "autonomy.auto_cross must be an array");
  }
  const autoCross: HarnessAutonomyGate[] = [];
  for (const gate of autonomy.auto_cross) {
    if (typeof gate !== "string" || !AUTONOMY_GATES.has(gate)) {
      return reject("invalid_gate", "desired.autonomy.auto_cross", "autonomy.auto_cross may contain only A and B");
    }
    if (autoCross.includes(gate as HarnessAutonomyGate)) {
      return reject("duplicate_gate", "desired.autonomy.auto_cross", "autonomy.auto_cross gates must be unique");
    }
    autoCross.push(gate as HarnessAutonomyGate);
  }

  const budgetValue = exactObject(
    autonomy.budget,
    "desired.autonomy.budget",
    ["max_tokens", "max_cost_usd", "max_wakes", "max_fix_rounds"]
  );
  const budget: HarnessAutonomyBudget = {
    max_tokens: boundedInteger(
      budgetValue.max_tokens,
      "desired.autonomy.budget.max_tokens",
      HARNESS_AUTONOMY_LIMITS.maxTokens.min,
      HARNESS_AUTONOMY_LIMITS.maxTokens.max
    ),
    max_cost_usd: boundedUsdCents(
      budgetValue.max_cost_usd,
      "desired.autonomy.budget.max_cost_usd",
      HARNESS_AUTONOMY_LIMITS.maxCostUsd.min,
      HARNESS_AUTONOMY_LIMITS.maxCostUsd.max
    ),
    max_wakes: boundedInteger(
      budgetValue.max_wakes,
      "desired.autonomy.budget.max_wakes",
      HARNESS_AUTONOMY_LIMITS.maxWakes.min,
      HARNESS_AUTONOMY_LIMITS.maxWakes.max
    ),
    max_fix_rounds: boundedInteger(
      budgetValue.max_fix_rounds,
      "desired.autonomy.budget.max_fix_rounds",
      HARNESS_AUTONOMY_LIMITS.maxFixRounds.min,
      HARNESS_AUTONOMY_LIMITS.maxFixRounds.max
    )
  };

  let wakeIntervals: Record<string, number> | undefined;
  if (Object.prototype.hasOwnProperty.call(autonomy, "wake_interval_s")) {
    const intervals = plainObject(autonomy.wake_interval_s, "desired.autonomy.wake_interval_s");
    wakeIntervals = {};
    for (const [rawPhase, seconds] of Object.entries(intervals)) {
      const phase = stableAsciiId(rawPhase, "desired.autonomy.wake_interval_s phase");
      if (Object.prototype.hasOwnProperty.call(wakeIntervals, phase)) {
        return reject("duplicate_key", "desired.autonomy.wake_interval_s", `duplicate normalized phase ${phase}`);
      }
      wakeIntervals[phase] = boundedInteger(
        seconds,
        `desired.autonomy.wake_interval_s.${phase}`,
        HARNESS_AUTONOMY_LIMITS.wakeIntervalSeconds.min,
        HARNESS_AUTONOMY_LIMITS.wakeIntervalSeconds.max
      );
    }
  }

  let notifyOn: HarnessAutonomyNotification[] | undefined;
  if (Object.prototype.hasOwnProperty.call(autonomy, "notify_on")) {
    if (!Array.isArray(autonomy.notify_on)) {
      return reject("invalid_type", "desired.autonomy.notify_on", "autonomy.notify_on must be an array");
    }
    notifyOn = [];
    for (const event of autonomy.notify_on) {
      if (typeof event !== "string" || !AUTONOMY_NOTIFICATIONS.has(event)) {
        return reject("invalid_notification", "desired.autonomy.notify_on", "autonomy.notify_on contains an unsupported event");
      }
      if (notifyOn.includes(event as HarnessAutonomyNotification)) {
        return reject("duplicate_notification", "desired.autonomy.notify_on", "autonomy.notify_on events must be unique");
      }
      notifyOn.push(event as HarnessAutonomyNotification);
    }
  }

  return {
    enabled: true,
    expires_at: autonomy.expires_at as string,
    auto_cross: autoCross,
    budget,
    ...(wakeIntervals === undefined ? {} : { wake_interval_s: wakeIntervals }),
    ...(notifyOn === undefined ? {} : { notify_on: notifyOn })
  };
}

/**
 * Validate and normalize the exact unsigned harness mode-intent payload.
 * Every object level is key-whitelisted; this function performs no I/O and does not read the clock.
 */
export function normalizeHarnessModeIntentPayload(
  value: unknown,
  context: HarnessModeIntentValidationContext
): HarnessModeIntentPayload {
  const nowEpoch = contextNowEpoch(context.now);
  const payload = exactObject(value, "intent", [
    "intent_id",
    "repo_key",
    "expected_head_sha",
    "desired",
    "issued_by",
    "issued_at",
    "intent_expires_at"
  ]);

  const expectedHeadSha = nonBlankString(payload.expected_head_sha, "expected_head_sha");
  if (!HEAD_SHA_PATTERN.test(expectedHeadSha)) {
    return reject("invalid_head_sha", "expected_head_sha", "expected_head_sha must be exactly 40 hexadecimal characters");
  }
  const issuedAtEpoch = timestampEpoch(payload.issued_at, "issued_at");
  const intentExpiryEpoch = timestampEpoch(payload.intent_expires_at, "intent_expires_at");
  if (intentExpiryEpoch <= nowEpoch) {
    return reject("expired_intent", "intent_expires_at", "mode intent must not be expired");
  }
  if (intentExpiryEpoch <= issuedAtEpoch) {
    return reject("invalid_expiry", "intent_expires_at", "intent_expires_at must be later than issued_at");
  }

  const desired = exactObject(payload.desired, "desired", ["execution", "autonomy"]);
  return {
    intent_id: nonBlankString(payload.intent_id, "intent_id"),
    repo_key: normalizeHarnessRepoKey(payload.repo_key),
    expected_head_sha: expectedHeadSha.toLowerCase(),
    desired: {
      execution: normalizeExecution(desired.execution, context.agents, context.tools),
      autonomy: normalizeAutonomy(desired.autonomy, nowEpoch)
    },
    issued_by: nonBlankString(payload.issued_by, "issued_by"),
    issued_at: payload.issued_at as string,
    intent_expires_at: payload.intent_expires_at as string
  };
}

export function validateHarnessModeIntentPayload(
  value: unknown,
  context: HarnessModeIntentValidationContext
): HarnessModeIntentValidationResult {
  try {
    return { ok: true, value: normalizeHarnessModeIntentPayload(value, context) };
  } catch (error) {
    if (error instanceof HarnessModeIntentValidationError) {
      return { ok: false, error: error.toIssue() };
    }
    throw error;
  }
}
