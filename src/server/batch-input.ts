import type { BatchUsageRequest, DeviceInput, UsageEventInput } from "@/shared/usage";
import type { QuotaSnapshotInput } from "@/quota/types";
import { MAX_AGENT_FEATURE_VERSION } from "@/shared/agent-feature-version";
import { parseHarnessSyncSnapshot } from "@/shared/harness-health";

export const MAX_BATCH_BODY_BYTES = 1024 * 1024;
export const MAX_USAGE_BATCH_ROWS = 200;
export const MAX_QUOTA_BATCH_ROWS = 100;
export const MAX_RAW_JSON_BYTES = 64 * 1024;
export const MAX_RAW_JSON_DEPTH = 8;
export const MAX_USAGE_INT = 2_147_483_647;
const SOURCES = new Set(["claude-code", "codex", "opencode", "aider", "kimicode"]);
const TOKEN_FIELDS = ["inputTokens", "outputTokens", "cachedInputTokens", "cacheWriteTokens", "reasoningOutputTokens", "totalTokens", "cacheEphemeral5mInputTokens", "cacheEphemeral1hInputTokens", "webSearchRequests", "webFetchRequests"];
const EVENT_STRINGS: Record<string, number> = {
  projectName: 200, sessionId: 512, workspacePath: 4096, localWorkspacePath: 4096,
  repoKey: 2048, gitRemote: 4096, gitBranch: 512, gitCommit: 128, model: 256,
  serviceTier: 100, fallbackFromModel: 256, fallbackToModel: 256
};
export type BatchInputErrorCode = "invalid_json" | "body_too_large" | "invalid_content_type" | "invalid_batch" | "batch_too_large" | "invalid_device" | "invalid_timezone" | "invalid_event" | "invalid_snapshot" | "invalid_raw_json";
export class BatchInputError extends Error {
  constructor(readonly code: BatchInputErrorCode, readonly row?: number) { super(code); }
}
function check(condition: unknown, code: BatchInputErrorCode, row?: number): asserts condition {
  if (!condition) throw new BatchInputError(code, row);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function scalarString(value: string): boolean {
  if (value.includes("\u0000")) return false;
  for (const char of value) {
    const point = char.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) return false;
  }
  return true;
}
function text(value: unknown, maximum: number, required = false): boolean {
  return (value == null && !required) || (typeof value === "string" && value.length <= maximum &&
    (!required || value.trim().length > 0) && !/[\u0000-\u001f\u007f-\u009f]/.test(value) && scalarString(value));
}
function count(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}
function finiteRange(value: unknown, upper: number, exclusive = false): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && (exclusive ? value < upper : value <= upper);
}
function utcTimestamp(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || value.slice(0, 4) === "0000") return false;
  const canonical = value.includes(".") ? value.replace(/\.(\d{1,3})Z$/, (_, fraction) => `.${fraction.padEnd(3, "0")}Z`) : value.replace("Z", ".000Z");
  return parsed.toISOString() === canonical;
}
function boundedJson(value: unknown, maxDepth: number): boolean {
  const stack = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (++nodes > 100_000 || item.depth > maxDepth) return false;
    if (typeof item.value === "string") { if (!scalarString(item.value)) return false; }
    else if (typeof item.value === "number") { if (!Number.isFinite(item.value)) return false; }
    else if (item.value !== null && typeof item.value === "object") {
      if (!Array.isArray(item.value) && !Object.keys(item.value).every(scalarString)) return false;
      for (const child of Object.values(item.value)) stack.push({ value: child, depth: item.depth + 1 });
    } else if (item.value !== null && typeof item.value !== "boolean") return false;
  }
  return true;
}
function rawJson(value: unknown, row?: number) {
  if (value === undefined) return;
  check(boundedJson(value, MAX_RAW_JSON_DEPTH), "invalid_raw_json", row);
  check(Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_RAW_JSON_BYTES, "invalid_raw_json", row);
}

// Do not trust Content-Length or request.json(): cap the actual byte stream
// before parsing, then cap traversal before recursive sanitizers or DB writes.
export async function readBoundedBatchJson(
  request: Request,
  options: { locateInvalidUsageRow?: boolean } = {}
): Promise<unknown> {
  check(/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""), "invalid_content_type");
  const length = request.headers.get("content-length");
  if (length !== null) {
    check(/^\d+$/.test(length), "invalid_json");
    check(Number(length) <= MAX_BATCH_BODY_BYTES, "body_too_large");
  }
  check(request.body, "invalid_json");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BATCH_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        throw new BatchInputError("body_too_large");
      }
      chunks.push(decoder.decode(chunk.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    const body: unknown = JSON.parse(chunks.join(""));
    if (!boundedJson(body, 32)) {
      if (options.locateInvalidUsageRow && record(body) && Array.isArray(body.events)) {
        const row = body.events.findIndex((event) => !boundedJson(event, 30));
        if (row >= 0) throw new BatchInputError("invalid_json", row);
      }
      throw new BatchInputError("invalid_json");
    }
    return body;
  } catch (error) {
    if (error instanceof BatchInputError) throw error;
    throw new BatchInputError("invalid_json");
  } finally {
    reader.releaseLock();
  }
}

function validateDevice(value: unknown, requireName: boolean) {
  check(record(value) && text(value.id, 200, true) && text(value.name, 200, requireName), "invalid_device");
  check(text(value.hostname, 255) && text(value.platform, 100), "invalid_device");
  rawJson(value.metadata);
  if (value.diagnostics !== undefined) {
    const diag = value.diagnostics;
    check(record(diag), "invalid_device");
    check(text(diag.agentVersion, 128) && text(diag.agentReleaseVersion, 128) && text(diag.lastError, 2048), "invalid_device");
    check(diag.agentFeatureVersion == null || count(diag.agentFeatureVersion, MAX_AGENT_FEATURE_VERSION), "invalid_device");
    check(diag.queueDepth === undefined || count(diag.queueDepth, MAX_USAGE_INT), "invalid_device");
    check(diag.lastSyncStatus == null || ["success", "failed"].includes(diag.lastSyncStatus as string), "invalid_device");
    check(diag.harness === undefined || parseHarnessSyncSnapshot(diag.harness), "invalid_device");
  }
}
function validateEvent(value: unknown, row: number) {
  check(record(value), "invalid_event", row);
  check(SOURCES.has(value.source as string) && text(value.sourceEventId, 2048, true), "invalid_event", row);
  check(utcTimestamp(value.occurredAt), "invalid_event", row);
  for (const [field, maximum] of Object.entries(EVENT_STRINGS)) check(text(value[field], maximum), "invalid_event", row);
  for (const field of TOKEN_FIELDS) check(value[field] === undefined || count(value[field], MAX_USAGE_INT), "invalid_event", row);
  // computeTotalTokens falls back to the sum when explicit total is zero/missing.
  if (!value.totalTokens) check((value.inputTokens as number ?? 0) + (value.outputTokens as number ?? 0) <= MAX_USAGE_INT, "invalid_event", row);
  check(value.costUsd == null || finiteRange(value.costUsd, 10_000_000_000, true), "invalid_event", row);
  rawJson(value.rawJson, row);
  if (value.source === "codex" && record(value.rawJson) && record(value.rawJson.payload) && record(value.rawJson.payload.info)) {
    const cumulative = value.rawJson.payload.info.total_token_usage;
    if (cumulative !== undefined) {
      check(record(cumulative), "invalid_event", row);
      for (const field of ["input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"]) {
        check(cumulative[field] === undefined || count(cumulative[field], Number.MAX_SAFE_INTEGER), "invalid_event", row);
      }
    }
  }
}

export function validateUsageBatch(value: unknown): BatchUsageRequest & { device: DeviceInput } {
  check(record(value) && Array.isArray(value.events), "invalid_batch");
  check(value.events.length <= MAX_USAGE_BATCH_ROWS, "batch_too_large");
  validateDevice(value.device, true);
  if (value.timezone !== undefined) {
    check(text(value.timezone, 64, true), "invalid_timezone");
    try { new Intl.DateTimeFormat("en-US", { timeZone: value.timezone as string }); }
    catch { throw new BatchInputError("invalid_timezone"); }
  }
  value.events.forEach(validateEvent);
  return value as unknown as BatchUsageRequest & { device: DeviceInput; events: UsageEventInput[] };
}

export type UsagePartialRejection = {
  row: number;
  code: "invalid_event" | "invalid_raw_json";
};

export function validateUsageBatchPartial(value: unknown): {
  body: BatchUsageRequest & { device: DeviceInput };
  acceptedRows: number[];
  rejected: UsagePartialRejection[];
} {
  check(record(value) && Array.isArray(value.events), "invalid_batch");
  check(value.events.length <= MAX_USAGE_BATCH_ROWS, "batch_too_large");
  validateDevice(value.device, true);
  if (value.timezone !== undefined) {
    check(text(value.timezone, 64, true), "invalid_timezone");
    try { new Intl.DateTimeFormat("en-US", { timeZone: value.timezone as string }); }
    catch { throw new BatchInputError("invalid_timezone"); }
  }

  const acceptedRows: number[] = [];
  const rejected: UsagePartialRejection[] = [];
  value.events.forEach((event, row) => {
    try {
      validateEvent(event, row);
      acceptedRows.push(row);
    } catch (error) {
      if (!(error instanceof BatchInputError) || error.row !== row ||
          (error.code !== "invalid_event" && error.code !== "invalid_raw_json")) throw error;
      rejected.push({ row, code: error.code });
    }
  });
  const events = acceptedRows.map((row) => value.events[row]) as UsageEventInput[];
  return {
    body: { ...value, events } as unknown as BatchUsageRequest & { device: DeviceInput },
    acceptedRows,
    rejected
  };
}

export function validateQuotaBatch(value: unknown): { device?: { id: string }; snapshots: QuotaSnapshotInput[] } {
  check(record(value) && Array.isArray(value.snapshots), "invalid_batch");
  check(value.snapshots.length <= MAX_QUOTA_BATCH_ROWS, "batch_too_large");
  // Existing quota Agents omit device; bind capturedBy to the authenticated token.
  if (value.device !== undefined) validateDevice(value.device, false);
  value.snapshots.forEach((snapshot, row) => {
    check(record(snapshot) && snapshot.provider === "codex-chatgpt", "invalid_snapshot", row);
    check(text(snapshot.accountKey, 256, true) && text(snapshot.windowKey, 200, true) && text(snapshot.unit, 100), "invalid_snapshot", row);
    check(snapshot.utilization == null || finiteRange(snapshot.utilization, 1), "invalid_snapshot", row);
    for (const field of ["usedRaw", "limitRaw"]) check(snapshot[field] == null || count(snapshot[field], Number.MAX_SAFE_INTEGER), "invalid_snapshot", row);
    check(snapshot.resetsAt == null || utcTimestamp(snapshot.resetsAt), "invalid_snapshot", row);
    rawJson(snapshot.rawJson, row);
  });
  return value as unknown as { device?: { id: string }; snapshots: QuotaSnapshotInput[] };
}

export function invalidBatchResponse(error: unknown): Response {
  const code = error instanceof BatchInputError ? error.code : "invalid_json";
  const row = error instanceof BatchInputError ? error.row : undefined;
  return Response.json({ error: "invalid batch request", code, ...(row === undefined ? {} : { row }) }, { status: 400 });
}
