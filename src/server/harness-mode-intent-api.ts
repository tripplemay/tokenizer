import { posix as posixPath } from "node:path";
import {
  HARNESS_TRANSPORTS,
  type HarnessModeAgentDescriptor,
  type HarnessModeIntentDesired
} from "@/shared/harness-mode-intent";

const UTC_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/;
const HEAD_SHA_PATTERN = /^[0-9a-fA-F]{40}$/;
const SHA256_PATTERN = /^[0-9a-fA-F]{64}$/;
const TRANSPORTS = new Set<string>(HARNESS_TRANSPORTS);
const DISPATCH_ROLES = new Set(["generator", "evaluator"]);
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
  const containsAbsolutePath =
    /(^|[^A-Za-z0-9_/])\/(?!\/)[^\s,;)\]}"']*/.test(summary) ||
    /\b[A-Za-z]:[\\/][^\s]*/.test(summary) ||
    /(^|[^A-Za-z0-9_\\])\\\\[^\\\s]+\\[^\\\s]+/.test(summary) ||
    /(^|[^A-Za-z0-9_/:])\/\/[^/\s]+\/[^\s]*/.test(summary) ||
    /\bfile:\/\//i.test(summary);
  if (containsAbsolutePath || RAW_CHANNEL_PATTERN.test(summary) || CREDENTIAL_PATTERN.test(summary)) {
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
  const modes = exactRecord(value, "state.modes", ["framework", "execution", "autonomy", "dispatch", "gate", "machinery"]);

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
    "agents",
    "familyExclusive",
    "issues"
  ]);
  modeBoolean(dispatch.enabled, "state.modes.dispatch.enabled");
  modeBoolean(dispatch.familyExclusive, "state.modes.dispatch.familyExclusive", true);
  const assignments = record(dispatch.assignments, "state.modes.dispatch.assignments");
  if (Object.keys(assignments).length > 32) return reject("invalid_mode_snapshot", "too many dispatch assignments");
  for (const [role, agentId] of Object.entries(assignments)) {
    if (SENSITIVE_FIELD_PATTERN.test(role)) {
      return reject("sensitive_summary_data", "state.modes contains data that may not be persisted");
    }
    modeString(role, "state.modes.dispatch assignment role", 64);
    modeString(agentId, "state.modes.dispatch assignment agent", 128);
  }
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
    ]);
    modeString(agent.id, "state.modes.dispatch agent id", 128);
    modeStrings(agent.roles, "state.modes.dispatch agent roles", 8, 64);
    modeString(agent.transport, "state.modes.dispatch agent transport", 32);
    modeString(agent.modelFamily, "state.modes.dispatch agent modelFamily", 128, true);
    modeString(agent.adapter, "state.modes.dispatch agent adapter", 128, true);
    modeBoolean(agent.sandboxed, "state.modes.dispatch agent sandboxed");
  }
  modeStrings(dispatch.issues, "state.modes.dispatch.issues", 100, 1_000);

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
