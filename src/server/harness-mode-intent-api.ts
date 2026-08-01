import { posix as posixPath } from "node:path";
import {
  HARNESS_MODE_ROLES,
  HARNESS_TRANSPORTS,
  type HarnessModeAgentDescriptor,
  type HarnessModeIntentDesired,
  type HarnessModeRole,
  type HarnessModeToolDescriptor
} from "@/shared/harness-mode-intent";
import {
  hasWellFormedExternalSubagentBridgeObservation,
  toolCatalogModeDescriptors,
  v2SelectableToolCatalogEntries,
  type HarnessToolCatalogEntry,
  type HarnessToolIntegration
} from "@/shared/harness-tool-catalog";

const UTC_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/;
const HEAD_SHA_PATTERN = /^[0-9a-fA-F]{40}$/;
const SHA256_PATTERN = /^[0-9a-fA-F]{64}$/;
const TOOL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SAFE_CAPABILITY_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const TRANSPORTS = new Set<string>(HARNESS_TRANSPORTS);
const DISPATCH_ROLES = new Set<string>(HARNESS_MODE_ROLES);
const RELAY_ACK_STATUSES = new Set(["staged", "applied", "failed"]);

export const HARNESS_REPORT_MAX_BYTES = 256 * 1024;
export const HARNESS_API_MAX_BYTES = 64 * 1024;
export const HARNESS_MODE_INTENT_ACTIVE_STATUSES = ["issued", "relayed", "staged"] as const;
export const HARNESS_MODE_INTENT_RELAY_STATUSES = ["issued", "relayed"] as const;

const RAW_CHANNEL_PATTERN =
  /(?:^|[^A-Za-z0-9_])(?:prompt|stdout|stderr|logs?|env(?:ironment)?|worktrees?|source)\s*[:=]/i;
const CREDENTIAL_PATTERN =
  /-----BEGIN [^-]*PRIVATE KEY-----|\b(?:Bearer|Basic)\s+\S+|(?:api[_-]?key|(?:(?:access|auth|refresh|id)[_-]?)?token|auth(?:orization)?|password|passwd|secrets?|credentials?|client[_-]?secret)\s*[:=]\s*\S+|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/i;
const SENSITIVE_FIELD_PATTERN =
  /^(?:prompt|stdout|stderr|logs?|env(?:ironment)?|worktrees?|source|credentials?)$/i;
const HARNESS_COMMAND_REFERENCE_LABELS = new Set(["feature.title"]);
const FORWARD_SLASH_UNC_PATH_PATTERN = /(^|[^A-Za-z0-9_/:])\/\/[^/\s]+\/[^\s]*/;
const KNOWN_HARNESS_COMMAND_REFERENCE_PATTERN =
  /(^|[^A-Za-z0-9_/])\/(?:plan|build|verify|dashboard|autodrive)(?=$|[\s,;:!)\]}"'`，。、；：！）】》」』]|\.(?=$|\s))/g;
const SAFE_ROUTE_REFERENCE_PATTERN =
  /(^|[^A-Za-z0-9_/])\/(?:api|v[1-9]\d*)\/[A-Za-z0-9][A-Za-z0-9_-]*(?:\/[A-Za-z0-9][A-Za-z0-9_-]*)*(?=$|[\s,;:!)\]}"'`，。、；：！）】》」』])/g;
const WORD_INTERNAL_SLASH_PATTERN = /(?<=[\p{L}\p{N}])\/(?=[\p{L}\p{N}])/gu;
const STANDALONE_PROSE_SLASH_PATTERN = /(?<=\s)\/(?=\s)/g;

type UnknownRecord = Record<string, unknown>;

export class HarnessApiInputError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "HarnessApiInputError";
    this.code = code;
    this.status = status;
  }
}

function reject(code: string, message: string, status = 400): never {
  throw new HarnessApiInputError(code, message, status);
}

export function harnessInputErrorResponse(error: unknown): Response {
  if (error instanceof HarnessApiInputError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return Response.json({ error: "invalid request", code: "invalid_request" }, { status: 400 });
}

function assertJsonBounds(value: unknown, depth = 0, state = { nodes: 0 }): void {
  state.nodes += 1;
  if (state.nodes > 5_000 || depth > 12) reject("payload_too_complex", "request payload is too complex");
  if (typeof value === "string") {
    if (value.length > 4_096) reject("string_too_long", "request contains an oversized string");
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    if (value.length > 500) reject("array_too_long", "request contains an oversized array");
    for (const item of value) assertJsonBounds(item, depth + 1, state);
    return;
  }
  const keys = Object.keys(value as UnknownRecord);
  if (keys.length > 200) reject("object_too_large", "request contains too many fields");
  for (const key of keys) {
    if (key.length > 64) reject("field_too_long", "request contains an oversized field name");
    assertJsonBounds((value as UnknownRecord)[key], depth + 1, state);
  }
}

export async function readBoundedJson(request: Request, maxBytes = HARNESS_API_MAX_BYTES): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return reject("payload_too_large", "request body is too large", 413);
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    return reject("payload_too_large", "request body is too large", 413);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return reject("invalid_json", "request body must be valid JSON");
  }
  assertJsonBounds(value);
  return value;
}

function record(value: unknown, label: string): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return reject("invalid_type", `${label} must be an object`);
  }
  return value as UnknownRecord;
}

function exactRecord(
  value: unknown,
  label: string,
  required: readonly string[],
  optional: readonly string[] = []
): UnknownRecord {
  const result = record(value, label);
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(result, key))) {
    return reject("missing_field", `${label} is missing a required field`);
  }
  if (Object.keys(result).some((key) => !allowed.has(key))) {
    return reject("unknown_field", `${label} contains unsupported fields`);
  }
  return result;
}

function boundedString(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") return reject("invalid_string", `${label} must be a string`);
  const result = value.trim();
  if (!result || result.length > max) {
    return reject("invalid_string", `${label} must contain between 1 and ${max} characters`);
  }
  return result;
}

function optionalBoundedString(value: unknown, label: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  return boundedString(value, label, max);
}

function safeInteger(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    return reject("invalid_number", `${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function parseUtcDate(value: unknown, label: string): Date {
  if (typeof value !== "string" || value.length > 40) {
    return reject("invalid_timestamp", `${label} must be an ISO-8601 UTC timestamp`);
  }
  const match = UTC_TIMESTAMP_PATTERN.exec(value);
  if (!match) return reject("invalid_timestamp", `${label} must be an ISO-8601 UTC timestamp`);

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
    return reject("invalid_timestamp", `${label} must be a valid calendar timestamp`);
  }

  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, Number((fraction + "000").slice(0, 3)));
  if (!Number.isFinite(date.getTime())) return reject("invalid_timestamp", `${label} must be a valid timestamp`);
  return date;
}

export function safePersistedSummary(value: unknown, label: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return reject("invalid_string", `${label} must be a string`);
  if (value.includes("\n") || value.includes("\r")) {
    return reject("sensitive_summary_data", `${label} contains data that may not be persisted`);
  }
  const summary = value.trim();
  if (!summary || value.length > max) {
    return reject("invalid_string", `${label} must contain between 1 and ${max} characters`);
  }
  const containsForwardSlashUncPath = FORWARD_SLASH_UNC_PATH_PATTERN.test(summary);
  const pathScanValue = HARNESS_COMMAND_REFERENCE_LABELS.has(label)
    ? summary
      .replace(KNOWN_HARNESS_COMMAND_REFERENCE_PATTERN, "$1")
      .replace(SAFE_ROUTE_REFERENCE_PATTERN, "$1")
      .replace(WORD_INTERNAL_SLASH_PATTERN, "")
      .replace(STANDALONE_PROSE_SLASH_PATTERN, "")
    : summary;
  const containsAbsolutePath =
    /(^|[^A-Za-z0-9_/])\/(?!\/)[^\s,;)\]}"']*/.test(pathScanValue) ||
    /\b[A-Za-z]:[\\/][^\s]*/.test(pathScanValue) ||
    /(^|[^A-Za-z0-9_\\])\\\\[^\\\s]+\\[^\\\s]+/.test(pathScanValue) ||
    FORWARD_SLASH_UNC_PATH_PATTERN.test(pathScanValue) ||
    /\bfile:\/\//i.test(pathScanValue);
  if (
    containsForwardSlashUncPath ||
    containsAbsolutePath ||
    RAW_CHANNEL_PATTERN.test(summary) ||
    CREDENTIAL_PATTERN.test(summary)
  ) {
    return reject("sensitive_summary_data", `${label} contains data that may not be persisted`);
  }
  return summary;
}

function fullHeadSha(value: unknown, label: string): string {
  const sha = boundedString(value, label, 40);
  if (!HEAD_SHA_PATTERN.test(sha)) {
    return reject("invalid_head_sha", `${label} must be exactly 40 hexadecimal characters`);
  }
  return sha.toLowerCase();
}

export type IssueModeIntentInput = {
  projectId: string;
  desired: HarnessModeIntentDesired;
  intentExpiresAt: Date;
};

export function parseIssueModeIntentInput(value: unknown): IssueModeIntentInput {
  const input = exactRecord(value, "request", ["projectId", "desired", "intentExpiresAt"]);
  return {
    projectId: boundedString(input.projectId, "projectId", 128),
    desired: input.desired as HarnessModeIntentDesired,
    intentExpiresAt: parseUtcDate(input.intentExpiresAt, "intentExpiresAt")
  };
}

export type CancelModeIntentInput = { projectId: string; intentId: string };

export function parseCancelModeIntentInput(value: unknown): CancelModeIntentInput {
  const input = exactRecord(value, "request", ["projectId", "intentId"]);
  return {
    projectId: boundedString(input.projectId, "projectId", 128),
    intentId: boundedString(input.intentId, "intentId", 128)
  };
}

export function parseProjectIdFromUrl(requestUrl: string): string {
  const projectId = new URL(requestUrl).searchParams.get("projectId");
  return boundedString(projectId, "projectId", 128);
}

export function modeAgentsFromSnapshot(value: unknown): HarnessModeAgentDescriptor[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return reject("invalid_mode_snapshot", "project does not have a usable dispatch agent snapshot", 409);
  }
  const modes = record(value, "mode snapshot");
  const dispatch = record(modes.dispatch, "mode snapshot dispatch");
  if (dispatch.enabled !== true || !Array.isArray(dispatch.agents) || dispatch.agents.length < 1 || dispatch.agents.length > 50) {
    return reject("invalid_mode_snapshot", "project does not have a usable dispatch agent snapshot", 409);
  }
  const seen = new Set<string>();
  return dispatch.agents.map((rawAgent) => {
    const agent = record(rawAgent, "mode snapshot agent");
    const id = boundedString(agent.id, "mode snapshot agent id", 128);
    if (seen.has(id)) return reject("invalid_mode_snapshot", "mode snapshot contains duplicate agents", 409);
    seen.add(id);
    if (!Array.isArray(agent.roles) || agent.roles.length < 1 || agent.roles.length > 8) {
      return reject("invalid_mode_snapshot", "mode snapshot contains invalid agent roles", 409);
    }
    const roles = agent.roles.map((role) => boundedString(role, "mode snapshot agent role", 32));
    const transport = boundedString(agent.transport, "mode snapshot agent transport", 32);
    if (!TRANSPORTS.has(transport)) {
      return reject("invalid_mode_snapshot", "mode snapshot contains an invalid transport", 409);
    }
    return {
      id,
      roles,
      transport: transport as HarnessModeAgentDescriptor["transport"],
      model_family: boundedString(agent.modelFamily, "mode snapshot agent model family", 128)
    };
  });
}

type ReportedIntegrationInventory = {
  present: boolean;
  integrations: HarnessToolIntegration[];
};

const BRIDGE_REPORT_FIELDS = [
  "bridgeId",
  "bridgeKind",
  "sessionScope",
  "bridgeProtocol",
  "bridgeCommand",
  "adapterBridgeCommand",
  "bridgeRoles"
] as const;

function reportedBridgeCommand(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 64) {
    return reject("invalid_mode_snapshot", `${label} must be a bounded command array`);
  }
  const command = value.map((item) => modeString(item, `${label} item`, 1_024)!);
  if (command[1] !== "acp" || command.some((item) => !SAFE_CAPABILITY_PATTERN.test(item))) {
    return reject("invalid_mode_snapshot", `${label} is not a published ACP command`);
  }
  return command;
}

function reportedBridgeRoles(value: unknown, label: string): HarnessModeRole[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > HARNESS_MODE_ROLES.length) {
    return reject("invalid_mode_snapshot", `${label} must be a bounded role array`);
  }
  const roles = value.map((item) => modeString(item, `${label} item`, 32)! as HarnessModeRole);
  if (new Set(roles).size !== roles.length || roles.some((role) => !DISPATCH_ROLES.has(role))) {
    return reject("invalid_mode_snapshot", `${label} contains an invalid bridge persona role`);
  }
  return roles;
}

/**
 * Parse the public tool-integration inventory once. Bridge fields are retained
 * as bounded device observations only; they are not a control-plane proof of
 * an external same-session route. A boolean/null subagent declaration remains
 * Coordinator-native compatibility metadata.
 */
function reportedIntegrationInventory(dispatch: UnknownRecord): ReportedIntegrationInventory {
  if (!Object.prototype.hasOwnProperty.call(dispatch, "integrations")) {
    return { present: false, integrations: [] };
  }
  if (!Array.isArray(dispatch.integrations) || dispatch.integrations.length > 50) {
    return reject("invalid_mode_snapshot", "state.modes.dispatch.integrations must be a bounded array");
  }

  const seenIntegrations = new Set<string>();
  const integrations: HarnessToolIntegration[] = [];
  for (const rawIntegration of dispatch.integrations) {
    const integration = exactRecord(rawIntegration, "state.modes.dispatch integration", [
      "id",
      "tool",
      "label",
      "modelFamily",
      "roles",
      "invocations",
      "capabilities",
      "localCli",
      "subagent",
      "a2aTargetCount",
      "sandboxed"
    ], [...BRIDGE_REPORT_FIELDS]);
    const id = modeString(integration.id, "state.modes.dispatch integration id", 64)!;
    const tool = modeString(integration.tool, "state.modes.dispatch integration tool", 64)!;
    if (seenIntegrations.has(id) || !TOOL_ID_PATTERN.test(id) || !TOOL_ID_PATTERN.test(tool)) {
      return reject("invalid_mode_snapshot", "state.modes.dispatch integration is not recognized");
    }
    seenIntegrations.add(id);
    const label = modeString(integration.label, "state.modes.dispatch integration label", 128)!;
    const modelFamily = modeString(integration.modelFamily, "state.modes.dispatch integration modelFamily", 128)!;
    if (!Array.isArray(integration.roles) || integration.roles.length < 1 || integration.roles.length > HARNESS_MODE_ROLES.length) {
      return reject("invalid_mode_snapshot", "state.modes.dispatch integration roles must be bounded");
    }
    const roles = integration.roles.map((role) =>
      modeString(role, "state.modes.dispatch integration role", 32)! as HarnessModeRole
    );
    if (new Set(roles).size !== roles.length || roles.some((role) => !DISPATCH_ROLES.has(role))) {
      return reject("invalid_mode_snapshot", "state.modes.dispatch integration role is not recognized");
    }
    if (!Array.isArray(integration.invocations) || integration.invocations.length < 1 || integration.invocations.length > HARNESS_TRANSPORTS.length) {
      return reject("invalid_mode_snapshot", "state.modes.dispatch integration invocations must be bounded");
    }
    const invocations = integration.invocations.map((invocation) =>
      modeString(invocation, "state.modes.dispatch integration invocation", 32)! as HarnessToolIntegration["invocations"][number]
    );
    if (new Set(invocations).size !== invocations.length || invocations.some((invocation) => !TRANSPORTS.has(invocation))) {
      return reject("invalid_mode_snapshot", "state.modes.dispatch integration invocation is not recognized");
    }
    if (!Array.isArray(integration.capabilities) || integration.capabilities.length > 64) {
      return reject("invalid_mode_snapshot", "state.modes.dispatch integration capabilities must be bounded");
    }
    const capabilities = integration.capabilities.map((capability) =>
      modeString(capability, "state.modes.dispatch integration capability", 64)!
    );
    if (new Set(capabilities).size !== capabilities.length) {
      return reject("invalid_mode_snapshot", "state.modes.dispatch integration capabilities must be unique");
    }
    const localCli = modeBoolean(integration.localCli, "state.modes.dispatch integration localCli")!;
    if (integration.subagent !== true && integration.subagent !== false && integration.subagent !== null) {
      return reject("invalid_mode_snapshot", "state.modes.dispatch integration subagent must be a boolean or null");
    }
    const subagent = integration.subagent === true;
    const sandboxed = modeBoolean(integration.sandboxed, "state.modes.dispatch integration sandboxed")!;
    const a2aTargetCount = safeInteger(
      integration.a2aTargetCount,
      "state.modes.dispatch integration a2aTargetCount",
      0,
      100
    );

    const hasExternalBridgeValue = BRIDGE_REPORT_FIELDS.some((field) => {
      const item = integration[field];
      return item !== undefined && item !== null;
    });
    let bridgeId: string | null = null;
    let bridgeKind: string | null = null;
    let sessionScope: "same-session" | null = null;
    let bridgeProtocol: HarnessToolIntegration["bridgeProtocol"] = null;
    let bridgeCommand: string[] | null = null;
    let adapterBridgeCommand: string[] | null = null;
    let bridgeRoles: HarnessModeRole[] | null = null;
    if (hasExternalBridgeValue) {
      bridgeId = modeString(integration.bridgeId, "state.modes.dispatch integration bridgeId", 64)!;
      bridgeKind = modeString(integration.bridgeKind, "state.modes.dispatch integration bridgeKind", 64)!;
      const rawSessionScope = modeString(integration.sessionScope, "state.modes.dispatch integration sessionScope", 32)!;
      const rawProtocol = modeString(integration.bridgeProtocol, "state.modes.dispatch integration bridgeProtocol", 64)!;
      bridgeCommand = reportedBridgeCommand(integration.bridgeCommand, "state.modes.dispatch integration bridgeCommand");
      adapterBridgeCommand = reportedBridgeCommand(
        integration.adapterBridgeCommand,
        "state.modes.dispatch integration adapterBridgeCommand"
      );
      bridgeRoles = reportedBridgeRoles(integration.bridgeRoles, "state.modes.dispatch integration bridgeRoles");
      if (
        !TOOL_ID_PATTERN.test(bridgeId) ||
        !SAFE_CAPABILITY_PATTERN.test(bridgeKind) ||
        rawSessionScope !== "same-session" ||
        rawProtocol !== "acp-native-agent/v1"
      ) return reject("invalid_mode_snapshot", "state.modes.dispatch integration bridge metadata is inconsistent");
      sessionScope = rawSessionScope;
      bridgeProtocol = rawProtocol;
    }

    const normalized: HarnessToolIntegration = {
      id,
      tool,
      label,
      modelFamily,
      roles,
      invocations,
      capabilities,
      localCli,
      subagent,
      bridgeId,
      bridgeKind,
      sessionScope,
      bridgeProtocol,
      bridgeCommand,
      adapterBridgeCommand,
      bridgeRoles,
      a2aTargetCount,
      sandboxed
    };
    if (
      localCli !== invocations.includes("local-cli") ||
      (localCli && !sandboxed) ||
      (!localCli && sandboxed) ||
      ((a2aTargetCount > 0) !== invocations.includes("a2a")) ||
      (!hasExternalBridgeValue && !subagent && invocations.includes("subagent")) ||
      (hasExternalBridgeValue && !hasWellFormedExternalSubagentBridgeObservation(normalized))
    ) return reject("invalid_mode_snapshot", "state.modes.dispatch integration transport facts are inconsistent");
    integrations.push(normalized);
  }
  return { present: true, integrations };
}

/**
 * Parse the device-reported public catalog. It is intentionally independent
 * from `dispatch.agents`: the framework tool-catalog contract owns canonical
 * tool identity and the local resolver owns concrete agent selection.
 */
function reportedToolCatalog(
  value: unknown,
  requireUsable: boolean
): HarnessToolCatalogEntry[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return reject("invalid_tool_catalog", "project does not have a usable tool capability catalog", 409);
  }
  const modes = record(value, "mode snapshot");
  const dispatch = record(modes.dispatch, "mode snapshot dispatch");
  // Agents before tool-integrations/1 reported this exact unavailable state
  // when they encountered a new-format registry. It is safe to persist as an
  // audit fact, but must never become a candidate source for v2 signing.
  if (dispatch.enabled === false && Array.isArray(dispatch.toolCatalog) && dispatch.toolCatalog.length === 0) {
    if (requireUsable) {
      return reject("invalid_tool_catalog", "project does not have a usable tool capability catalog", 409);
    }
    return [];
  }
  if (dispatch.enabled !== true || !Array.isArray(dispatch.toolCatalog) || dispatch.toolCatalog.length > 150) {
    return reject("invalid_tool_catalog", "project does not have a usable tool capability catalog", 409);
  }
  if (requireUsable && dispatch.toolCatalog.length < 1) {
    return reject("invalid_tool_catalog", "project does not have a usable tool capability catalog", 409);
  }

  const catalog: HarnessToolCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const rawCapability of dispatch.toolCatalog) {
    const capability = exactRecord(rawCapability, "mode snapshot tool capability", [
      "tool",
      "label",
      "invocation",
      "role",
      "agentCount",
      "modelFamilies",
      "capabilities"
    ]);
    const tool = modeString(capability.tool, "mode snapshot tool capability tool", 64)!;
    const label = modeString(capability.label, "mode snapshot tool capability label", 128)!;
    const invocation = modeString(capability.invocation, "mode snapshot tool capability invocation", 32)!;
    const role = modeString(capability.role, "mode snapshot tool capability role", 32)!;
    if (!TOOL_ID_PATTERN.test(tool) || !TRANSPORTS.has(invocation) || !DISPATCH_ROLES.has(role)) {
      return reject("invalid_tool_catalog", "project tool capability catalog contains an invalid entry", 409);
    }
    if (!Array.isArray(capability.modelFamilies) || capability.modelFamilies.length < 1 || capability.modelFamilies.length > 50) {
      return reject("invalid_tool_catalog", "project tool capability catalog contains invalid model families", 409);
    }
    const modelFamilies = capability.modelFamilies.map((family) =>
      modeString(family, "mode snapshot tool capability model family", 128)!
    );
    if (new Set(modelFamilies).size !== modelFamilies.length) {
      return reject("invalid_tool_catalog", "project tool capability catalog contains duplicate model families", 409);
    }
    if (!Array.isArray(capability.capabilities) || capability.capabilities.length > 64) {
      return reject("invalid_tool_catalog", "project tool capability catalog contains invalid capabilities", 409);
    }
    const capabilities = capability.capabilities.map((item) =>
      modeString(item, "mode snapshot tool capability capability", 64)!
    );
    if (new Set(capabilities).size !== capabilities.length) {
      return reject("invalid_tool_catalog", "project tool capability catalog contains duplicate capabilities", 409);
    }
    const agentCount = safeInteger(capability.agentCount, "mode snapshot tool capability agentCount", 1, 50);
    const key = `${role}\u0000${tool}\u0000${invocation}`;
    if (seen.has(key)) {
      return reject("invalid_tool_catalog", "project tool capability catalog contains duplicate entries", 409);
    }
    seen.add(key);
    catalog.push({
      tool,
      label,
      invocation: invocation as HarnessToolCatalogEntry["invocation"],
      role: role as HarnessModeRole,
      agentCount,
      modelFamilies,
      capabilities
    });
  }
  // A report may still contain a historical Coordinator-native or external
  // `subagent` observation. This release has no independently attested
  // VM/ephemeral-principal provider, so reports cannot elevate it into a
  // mode-intent choice. Only the filtered inventory reaches signing.
  const selectableCatalog = v2SelectableToolCatalogEntries(catalog);
  if (requireUsable && selectableCatalog.length === 0) {
    return reject("invalid_tool_catalog", "project does not have a selectable tool capability catalog", 409);
  }
  return requireUsable ? selectableCatalog : catalog;
}

/** Expand public candidate pools into the model-family facts required by v2 signing validation. */
export function modeToolCatalogFromSnapshot(value: unknown): HarnessModeToolDescriptor[] {
  return toolCatalogModeDescriptors(reportedToolCatalog(value, true));
}

export type RelayModeIntentAck =
  | { projectId: string; intentId: string; status: "staged"; stagedAt: Date; stagedCommitSha: string | null }
  | { projectId: string; intentId: string; status: "applied"; appliedAt: Date; appliedBatch: string }
  | {
      projectId: string;
      intentId: string;
      status: "failed";
      failedAt: Date;
      failureCode: string;
      failureDetail: string | null;
    };

export function parseRelayModeIntentAck(value: unknown): RelayModeIntentAck {
  const base = record(value, "request");
  if (typeof base.status !== "string" || !RELAY_ACK_STATUSES.has(base.status)) {
    return reject("invalid_status", "status must be staged, applied, or failed");
  }
  const projectId = boundedString(base.projectId, "projectId", 128);
  const intentId = boundedString(base.intentId, "intentId", 128);
  if (base.status === "staged") {
    const input = exactRecord(value, "request", ["projectId", "intentId", "status", "stagedAt"], ["stagedCommitSha"]);
    const stagedCommitSha = optionalBoundedString(input.stagedCommitSha, "stagedCommitSha", 40);
    if (stagedCommitSha !== null && !HEAD_SHA_PATTERN.test(stagedCommitSha)) {
      return reject("invalid_head_sha", "stagedCommitSha must be exactly 40 hexadecimal characters");
    }
    return {
      projectId,
      intentId,
      status: "staged",
      stagedAt: parseUtcDate(input.stagedAt, "stagedAt"),
      stagedCommitSha: stagedCommitSha?.toLowerCase() ?? null
    };
  }
  if (base.status === "applied") {
    const input = exactRecord(value, "request", ["projectId", "intentId", "status", "appliedAt", "appliedBatch"]);
    return {
      projectId,
      intentId,
      status: "applied",
      appliedAt: parseUtcDate(input.appliedAt, "appliedAt"),
      appliedBatch: boundedString(input.appliedBatch, "appliedBatch", 128)
    };
  }
  const input = exactRecord(
    value,
    "request",
    ["projectId", "intentId", "status", "failedAt", "failureCode"],
    ["failureDetail"]
  );
  return {
    projectId,
    intentId,
    status: "failed",
    failedAt: parseUtcDate(input.failedAt, "failedAt"),
    failureCode: boundedString(input.failureCode, "failureCode", 64),
    failureDetail: safePersistedSummary(input.failureDetail, "failureDetail", 500)
  };
}

type ModeIntentAckRow = {
  status: string;
  stagedAt?: Date | null;
  stagedCommitSha?: string | null;
  appliedAt?: Date | null;
  appliedBatch?: string | null;
  failedAt?: Date | null;
  failureCode?: string | null;
  failureDetail?: string | null;
};

function sameDate(left: Date | null | undefined, right: Date): boolean {
  return left instanceof Date && left.getTime() === right.getTime();
}

export function isIdenticalRelayAck(row: ModeIntentAckRow, ack: RelayModeIntentAck): boolean {
  if (row.status !== ack.status) return false;
  if (ack.status === "staged") {
    return sameDate(row.stagedAt, ack.stagedAt) && (row.stagedCommitSha ?? null) === ack.stagedCommitSha;
  }
  if (ack.status === "applied") {
    return sameDate(row.appliedAt, ack.appliedAt) && row.appliedBatch === ack.appliedBatch;
  }
  return (
    sameDate(row.failedAt, ack.failedAt) &&
    row.failureCode === ack.failureCode &&
    (row.failureDetail ?? null) === ack.failureDetail
  );
}

export function relayAckSourceStatuses(status: RelayModeIntentAck["status"]): readonly string[] {
  if (status === "staged") return ["issued", "relayed"];
  if (status === "applied") return ["staged"];
  return ["issued", "relayed", "staged"];
}

export type ReportModeDefaultsSummary = {
  intentId: string;
  stagedAt: Date;
  stagedCommitSha: string | null;
};

export function parseModeDefaultsSummary(value: unknown): ReportModeDefaultsSummary | null {
  if (value === undefined || value === null) return null;
  const summary = exactRecord(value, "modeDefaults", ["intentId", "stagedAt"], ["stagedCommitSha"]);
  const stagedCommitSha = optionalBoundedString(summary.stagedCommitSha, "modeDefaults.stagedCommitSha", 40);
  if (stagedCommitSha !== null && !HEAD_SHA_PATTERN.test(stagedCommitSha)) {
    return reject("invalid_head_sha", "modeDefaults.stagedCommitSha must be a full commit SHA");
  }
  return {
    intentId: boundedString(summary.intentId, "modeDefaults.intentId", 128),
    stagedAt: parseUtcDate(summary.stagedAt, "modeDefaults.stagedAt"),
    stagedCommitSha: stagedCommitSha?.toLowerCase() ?? null
  };
}

export type ReportModeIntentSummary = { intentId: string; appliedAt: Date; appliedBatch: string };

export function parseModeIntentSummary(value: unknown): ReportModeIntentSummary | null {
  if (value === undefined || value === null) return null;
  const summary = exactRecord(value, "modeIntent", ["intentId", "appliedAt", "appliedBatch"]);
  return {
    intentId: boundedString(summary.intentId, "modeIntent.intentId", 128),
    appliedAt: parseUtcDate(summary.appliedAt, "modeIntent.appliedAt"),
    appliedBatch: boundedString(summary.appliedBatch, "modeIntent.appliedBatch", 128)
  };
}

function modeString(value: unknown, label: string, max: number, nullable = false): string | null {
  const result = safePersistedSummary(value, label, max);
  if (result === null && !nullable) return reject("invalid_string", `${label} must be a string`);
  return result;
}

function modeBoolean(value: unknown, label: string, nullable = false): boolean | null {
  if (nullable && value === null) return null;
  if (typeof value !== "boolean") return reject("invalid_boolean", `${label} must be a boolean`);
  return value;
}

function modeStrings(value: unknown, label: string, maxItems: number, maxLength: number): void {
  if (!Array.isArray(value) || value.length > maxItems) {
    return reject("invalid_mode_snapshot", `${label} must be a bounded array`);
  }
  for (const item of value) modeString(item, `${label} item`, maxLength);
}

function modeCount(value: unknown, label: string): void {
  safeInteger(value, label, 0, 1_000_000);
}

export function parseModeSnapshot(value: unknown): UnknownRecord | null {
  if (value === undefined || value === null) return null;
  const modes = exactRecord(value, "state.modes", [
    "framework",
    "execution",
    "autonomy",
    "dispatch",
    "gate",
    "machinery"
  ], ["current", "pendingDefaults"]);

  if (modes.framework !== null) {
    const framework = exactRecord(modes.framework, "state.modes.framework", [
      "version",
      "commit",
      "adopted",
      "managedCount",
      "drift",
      "scanned"
    ]);
    modeString(framework.version, "state.modes.framework.version", 128, true);
    modeString(framework.commit, "state.modes.framework.commit", 128, true);
    modeBoolean(framework.adopted, "state.modes.framework.adopted");
    modeCount(framework.managedCount, "state.modes.framework.managedCount");
    modeBoolean(framework.scanned, "state.modes.framework.scanned");
    const drift = exactRecord(framework.drift, "state.modes.framework.drift", [
      "ok",
      "modified",
      "missing",
      "customized"
    ]);
    for (const key of ["ok", "modified", "missing", "customized"] as const) {
      modeCount(drift[key], `state.modes.framework.drift.${key}`);
    }
  }

  const execution = modeString(modes.execution, "state.modes.execution", 32);
  if (!new Set(["fast", "heterogeneous", "slow", "unknown"]).has(execution!)) {
    return reject("invalid_mode_snapshot", "state.modes.execution is not recognized");
  }

  if (modes.current !== undefined && modes.current !== null) {
    const current = exactRecord(modes.current, "state.modes.current", ["profile", "roleBindings"]);
    const profile = modeString(current.profile, "state.modes.current.profile", 32);
    if (profile !== "heterogeneous" && profile !== "slow") {
      return reject("invalid_mode_snapshot", "state.modes.current.profile is not a resolved non-fast profile");
    }
    if (profile !== execution) {
      return reject("invalid_mode_snapshot", "state.modes.current.profile must match state.modes.execution");
    }
    const bindings = exactRecord(current.roleBindings, "state.modes.current.roleBindings", ["planner", "generator", "evaluator"]);
    const invocations: string[] = [];
    for (const role of HARNESS_MODE_ROLES) {
      if (role === "planner" && bindings[role] === null) continue;
      const binding = exactRecord(bindings[role], `state.modes.current.roleBindings.${role}`, [
        "tool",
        "invocation",
        "modelFamily"
      ]);
      const tool = modeString(binding.tool, `state.modes.current.roleBindings.${role}.tool`, 64);
      if (!TOOL_ID_PATTERN.test(tool!)) {
        return reject("invalid_mode_snapshot", "state.modes.current role binding tool is not recognized");
      }
      const invocation = modeString(binding.invocation, `state.modes.current.roleBindings.${role}.invocation`, 32);
      if (!TRANSPORTS.has(invocation!)) {
        return reject("invalid_mode_snapshot", "state.modes.current role binding invocation is not recognized");
      }
      invocations.push(invocation!);
      modeString(binding.modelFamily, `state.modes.current.roleBindings.${role}.modelFamily`, 128);
    }
    if (
      (profile === "slow" && !invocations.includes("a2a")) ||
      (
        profile === "heterogeneous" &&
        (invocations.includes("a2a") || !invocations.some((invocation) => invocation === "local-cli" || invocation === "subagent"))
      )
    ) {
      return reject("invalid_mode_snapshot", "state.modes.current.profile does not match resolved invocations");
    }
  }

  const autonomy = exactRecord(modes.autonomy, "state.modes.autonomy", [
    "enabled",
    "policyValid",
    "authorizedBy",
    "expiresAt",
    "status"
  ]);
  modeBoolean(autonomy.enabled, "state.modes.autonomy.enabled");
  modeBoolean(autonomy.policyValid, "state.modes.autonomy.policyValid", true);
  modeString(autonomy.authorizedBy, "state.modes.autonomy.authorizedBy", 256, true);
  modeString(autonomy.expiresAt, "state.modes.autonomy.expiresAt", 40, true);
  modeString(autonomy.status, "state.modes.autonomy.status", 64, true);

  const dispatch = exactRecord(modes.dispatch, "state.modes.dispatch", [
    "enabled",
    "assignments",
    "familyExclusive",
    "issues"
  ], ["agents", "integrations", "toolCatalog"]);
  modeBoolean(dispatch.enabled, "state.modes.dispatch.enabled");
  modeBoolean(dispatch.familyExclusive, "state.modes.dispatch.familyExclusive", true);
  const assignments = record(dispatch.assignments, "state.modes.dispatch.assignments");
  if (Object.keys(assignments).length > 32) return reject("invalid_mode_snapshot", "too many dispatch assignments");
  for (const [role, agentId] of Object.entries(assignments)) {
    if (SENSITIVE_FIELD_PATTERN.test(role)) {
      return reject("sensitive_summary_data", "state.modes contains data that may not be persisted");
    }
    modeString(role, "state.modes.dispatch assignment role", 64);
    if (agentId === null) {
      if (role !== "planner") {
        return reject("invalid_mode_snapshot", "only Planner may use a null Coordinator assignment");
      }
      continue;
    }
    modeString(agentId, "state.modes.dispatch assignment agent", 128);
  }
  if (dispatch.agents !== undefined) {
    if (!Array.isArray(dispatch.agents) || dispatch.agents.length > 50) {
      return reject("invalid_mode_snapshot", "state.modes.dispatch.agents must be a bounded array");
    }
    for (const rawAgent of dispatch.agents) {
      const agent = exactRecord(rawAgent, "state.modes.dispatch agent", [
        "id",
        "roles",
        "transport",
        "modelFamily",
        "adapter",
        "sandboxed"
      ], ["capabilities"]);
      modeString(agent.id, "state.modes.dispatch agent id", 128);
      modeStrings(agent.roles, "state.modes.dispatch agent roles", 8, 64);
      modeString(agent.transport, "state.modes.dispatch agent transport", 32);
      modeString(agent.modelFamily, "state.modes.dispatch agent modelFamily", 128, true);
      modeString(agent.adapter, "state.modes.dispatch agent adapter", 128, true);
      modeBoolean(agent.sandboxed, "state.modes.dispatch agent sandboxed");
      if (agent.capabilities !== undefined) {
        modeStrings(agent.capabilities, "state.modes.dispatch agent capabilities", 32, 64);
      }
    }
  }
  // Parse and retain integrations as report observations. They deliberately
  // never participate in deriving the v2 selectable tool catalog below.
  reportedIntegrationInventory(dispatch);
  if (dispatch.enabled === true && dispatch.agents === undefined && dispatch.integrations === undefined) {
    return reject("invalid_mode_snapshot", "state.modes.dispatch requires an inventory");
  }
  modeStrings(dispatch.issues, "state.modes.dispatch.issues", 100, 1_000);
  if (dispatch.toolCatalog !== undefined) {
    // This is a framework-produced, agent-id-free catalog. Do not derive tool
    // ids from visible agent cards: data-only adapter canonicalization follows
    // the tool-catalog contract and may evolve independently of Tokenizer.
    reportedToolCatalog(modes, false);
  }

  const gate = exactRecord(modes.gate, "state.modes.gate", ["pubInstalled", "guardMode", "pendingGateId"]);
  modeBoolean(gate.pubInstalled, "state.modes.gate.pubInstalled");
  const guardMode = modeString(gate.guardMode, "state.modes.gate.guardMode", 32);
  if (guardMode !== "signature" && guardMode !== "head-compare") {
    return reject("invalid_mode_snapshot", "state.modes.gate.guardMode is not recognized");
  }
  modeString(gate.pendingGateId, "state.modes.gate.pendingGateId", 128, true);

  const machinery = exactRecord(modes.machinery, "state.modes.machinery", ["denyListMerged", "hooks", "missing"]);
  modeBoolean(machinery.denyListMerged, "state.modes.machinery.denyListMerged", true);
  modeStrings(machinery.hooks, "state.modes.machinery.hooks", 100, 128);
  modeStrings(machinery.missing, "state.modes.machinery.missing", 100, 128);

  if (modes.pendingDefaults !== undefined && modes.pendingDefaults !== null) {
    const defaults = exactRecord(modes.pendingDefaults, "state.modes.pendingDefaults", [
      "intentId",
      "stagedAt",
      "intentExpiresAt",
      "execution",
      "autonomy"
    ]);
    modeString(defaults.intentId, "state.modes.pendingDefaults.intentId", 128);
    const stagedAt = parseUtcDate(defaults.stagedAt, "state.modes.pendingDefaults.stagedAt");
    const intentExpiresAt = parseUtcDate(
      defaults.intentExpiresAt,
      "state.modes.pendingDefaults.intentExpiresAt"
    );
    if (stagedAt.getTime() >= intentExpiresAt.getTime()) {
      return reject(
        "invalid_mode_snapshot",
        "state.modes.pendingDefaults.stagedAt must precede intentExpiresAt"
      );
    }

    const pendingExecution = exactRecord(
      defaults.execution,
      "state.modes.pendingDefaults.execution",
      ["profile"],
      ["roleAssignments", "roleBindings"]
    );
    const pendingProfile = modeString(
      pendingExecution.profile,
      "state.modes.pendingDefaults.execution.profile",
      32
    );
    if (!new Set(["fast", "heterogeneous", "slow"]).has(pendingProfile!)) {
      return reject("invalid_mode_snapshot", "state.modes.pendingDefaults.execution.profile is not recognized");
    }
    const hasAssignments = pendingExecution.roleAssignments !== undefined && pendingExecution.roleAssignments !== null;
    const hasBindings = pendingExecution.roleBindings !== undefined && pendingExecution.roleBindings !== null;
    if (pendingProfile === "fast" && (hasAssignments || hasBindings)) {
      return reject(
        "invalid_mode_snapshot",
        "state.modes.pendingDefaults fast profile requires null role assignments and bindings"
      );
    }
    if (pendingProfile !== "fast" && hasAssignments === hasBindings) {
      return reject(
        "invalid_mode_snapshot",
        "state.modes.pendingDefaults heterogeneous and slow profiles require exactly one role assignment form"
      );
    }
    if (hasAssignments) {
      const assignments = exactRecord(
        pendingExecution.roleAssignments,
        "state.modes.pendingDefaults.execution.roleAssignments",
        ["generator", "evaluator"]
      );
      modeString(assignments.generator, "state.modes.pendingDefaults.execution.roleAssignments.generator", 128);
      modeString(assignments.evaluator, "state.modes.pendingDefaults.execution.roleAssignments.evaluator", 128);
    }
    if (hasBindings) {
      const bindings = exactRecord(
        pendingExecution.roleBindings,
        "state.modes.pendingDefaults.execution.roleBindings",
        ["planner", "generator", "evaluator"]
      );
      for (const role of HARNESS_MODE_ROLES) {
        if (role === "planner" && bindings[role] === null) continue;
        const binding = exactRecord(
          bindings[role],
          `state.modes.pendingDefaults.execution.roleBindings.${role}`,
          ["tool", "invocation"]
        );
        modeString(binding.tool, `state.modes.pendingDefaults.execution.roleBindings.${role}.tool`, 128);
        const invocation = modeString(
          binding.invocation,
          `state.modes.pendingDefaults.execution.roleBindings.${role}.invocation`,
          32
        );
        if (!TRANSPORTS.has(invocation!)) {
          return reject("invalid_mode_snapshot", "state.modes.pendingDefaults role binding invocation is not recognized");
        }
      }
    }

    const pendingAutonomy = exactRecord(defaults.autonomy, "state.modes.pendingDefaults.autonomy", [
      "enabled",
      "expiresAt"
    ]);
    modeBoolean(pendingAutonomy.enabled, "state.modes.pendingDefaults.autonomy.enabled");
    if (pendingAutonomy.expiresAt !== null) {
      parseUtcDate(pendingAutonomy.expiresAt, "state.modes.pendingDefaults.autonomy.expiresAt");
    }
    if ((pendingAutonomy.enabled === true) !== (pendingAutonomy.expiresAt !== null)) {
      return reject("invalid_mode_snapshot", "state.modes.pendingDefaults.autonomy expiry does not match enabled");
    }
  }
  return modes;
}

export type HarnessDispatchRunInput = {
  runId: string;
  taskId: string;
  batch: string;
  feature: string | null;
  role: string;
  agentId: string;
  modelFamily: string;
  transport: string;
  lockedSha: string;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  outcome: string;
  exitCode: number | null;
  verdict: string | null;
  artifactPath: string | null;
  artifactSha256: string | null;
  errorSummary: string | null;
};

const DISPATCH_REQUIRED_FIELDS = [
  "runId",
  "taskId",
  "batch",
  "role",
  "agentId",
  "modelFamily",
  "transport",
  "lockedSha",
  "startedAt",
  "finishedAt",
  "durationMs",
  "outcome"
] as const;
const DISPATCH_OPTIONAL_FIELDS = [
  "feature",
  "exitCode",
  "verdict",
  "artifactPath",
  "artifactSha256",
  "errorSummary"
] as const;

function repoRelativeArtifactPath(value: unknown): string | null {
  const path = optionalBoundedString(value, "artifactPath", 512);
  if (path === null) return null;
  const segments = path.split("/");
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  if (
    posixPath.isAbsolute(path) ||
    path.includes("\\") ||
    path.startsWith("~") ||
    /^[A-Za-z]:/.test(path) ||
    segments.some((segment) => !segment || segment === "." || segment === "..") ||
    lowerSegments.some((segment) => segment.includes("worktree")) ||
    posixPath.normalize(path) !== path
  ) {
    return reject("invalid_artifact_path", "artifactPath must be a basename or repository-relative path");
  }
  return path;
}

function safeErrorSummary(value: unknown): string | null {
  return safePersistedSummary(value, "errorSummary", 500);
}

export function parseDispatchRuns(value: unknown): HarnessDispatchRunInput[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 50) {
    return reject("invalid_dispatch_runs", "dispatchRuns must be an array with at most 50 entries");
  }
  const seen = new Set<string>();
  return value.map((rawRun) => {
    const run = exactRecord(rawRun, "dispatch run", DISPATCH_REQUIRED_FIELDS, DISPATCH_OPTIONAL_FIELDS);
    const runId = boundedString(run.runId, "runId", 128);
    if (seen.has(runId)) return reject("duplicate_run_id", "dispatchRuns contains a duplicate runId");
    seen.add(runId);
    const role = boundedString(run.role, "role", 32);
    if (!DISPATCH_ROLES.has(role)) return reject("invalid_role", "dispatch role is not recognized");
    const transport = boundedString(run.transport, "transport", 32);
    if (!TRANSPORTS.has(transport)) return reject("invalid_transport", "dispatch transport is not recognized");
    const startedAt = parseUtcDate(run.startedAt, "startedAt");
    const finishedAt = parseUtcDate(run.finishedAt, "finishedAt");
    if (finishedAt < startedAt) return reject("invalid_dates", "finishedAt must not precede startedAt");
    const artifactSha256 = optionalBoundedString(run.artifactSha256, "artifactSha256", 64);
    if (artifactSha256 !== null && !SHA256_PATTERN.test(artifactSha256)) {
      return reject("invalid_sha256", "artifactSha256 must be exactly 64 hexadecimal characters");
    }
    return {
      runId,
      taskId: boundedString(run.taskId, "taskId", 128),
      batch: boundedString(run.batch, "batch", 128),
      feature: optionalBoundedString(run.feature, "feature", 128),
      role,
      agentId: boundedString(run.agentId, "agentId", 128),
      modelFamily: boundedString(run.modelFamily, "modelFamily", 128),
      transport,
      lockedSha: fullHeadSha(run.lockedSha, "lockedSha"),
      startedAt,
      finishedAt,
      durationMs: safeInteger(run.durationMs, "durationMs", 0, 7 * 24 * 60 * 60 * 1000),
      outcome: boundedString(run.outcome, "outcome", 64),
      exitCode:
        run.exitCode === undefined || run.exitCode === null
          ? null
          : safeInteger(run.exitCode, "exitCode", 0, 255),
      verdict: safePersistedSummary(run.verdict, "verdict", 64),
      artifactPath: repoRelativeArtifactPath(run.artifactPath),
      artifactSha256: artifactSha256?.toLowerCase() ?? null,
      errorSummary: safeErrorSummary(run.errorSummary)
    };
  });
}
