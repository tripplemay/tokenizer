import { existsSync, readFileSync } from "node:fs";
import { BatchUsageRequest, DeviceDiagnostics, DeviceInput, UsageEventInput } from "@/shared/usage";
import { minimizeUsageEvent } from "@/shared/usage-privacy";
import { queuePath, readCredentials, readDevice, statePath, TokenizerConfig } from "./config";
import { getAgentVersion } from "./agent-version";
import { AGENT_FEATURE_VERSION } from "@/shared/agent-feature-version";
import { CURRENT_AGENT_RELEASE_VERSION } from "@/shared/agent-release-version";
import { agentFetch } from "./fetch";
import { parseHarnessSyncSnapshot } from "@/shared/harness-health";
import { sanitizeUsageEventGit } from "@/shared/git-remote";
import { effectivePrivacy } from "./privacy";
import { USAGE_PARTIAL_ACK_PROTOCOL } from "@/shared/usage-batch-protocol";
import { readQueue as readDurableQueue, resolveQueueEvents } from "./queue";

const ROW_REJECTION_CODES = new Set(["invalid_event", "invalid_raw_json", "invalid_json"]);

type BatchResult = {
  inserted: number;
  updated?: number;
  duplicates: number;
  received: number;
  deviceId?: string;
  protocol?: string;
  accepted?: Array<{ row: number; source: string; sourceEventId: string }>;
  rejected?: Array<{ row: number; code: string }>;
};

class BatchHttpError extends Error {
  constructor(readonly status: number, readonly code?: string, readonly row?: number) {
    super(`Sync failed: ${status}${code ? ` ${code}` : ""}`);
  }
}

export const readQueue = readDurableQueue;

export function clearQueue(expected: UsageEventInput[] = readDurableQueue()) {
  resolveQueueEvents({ accepted: expected, rejected: [] });
}

// Batches remain small so a retry is bounded under slow ingest/database load.
const BATCH_SIZE = 25;
// Generous per-request timeout. After the macOS-sleep / wake fix, an
// in-flight fetch that was active when the host suspended often becomes
// permanently stuck — without a timeout, the agent will block forever on
// that orphan socket. 60s is enough for a healthy POST (sub-second on Phase
// 1's batched ingest) while guaranteeing a wake-up retry path.
const REQUEST_TIMEOUT_MS = 60_000;

// A multi-batch run (especially the one-time parser-v2 backfill: 200+
// sequential batches) shouldn't abort on one transient network blip — the
// user's proxy path in particular drops the occasional request. Re-sending a
// batch is idempotent server-side (skipDuplicates + compare-equal
// corrections), so retry each batch a couple of times before giving up.
const BATCH_RETRY_DELAYS_MS = [5_000, 15_000];

async function syncBatchWithRetry(config: TokenizerConfig, batch: UsageEventInput[]) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await postBatch(config, batch);
    } catch (error) {
      if (!retryable(error) || attempt >= BATCH_RETRY_DELAYS_MS.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, BATCH_RETRY_DELAYS_MS[attempt]));
    }
  }
}

function retryable(error: unknown): boolean {
  if (!(error instanceof BatchHttpError)) return true;
  return error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
}

export type SyncBatchProgress = {
  synced: number;
  total: number;
  remaining: UsageEventInput[];
};

export type SyncEventsOptions = {
  onBatchSynced?: (progress: SyncBatchProgress) => void | Promise<void>;
};

export type SyncEventsResult = {
  inserted: number;
  updated: number;
  duplicates: number;
  received: number;
  rejected?: number;
  deviceId: string;
};

function newestFirst(events: UsageEventInput[]): UsageEventInput[] {
  return events
    .map((event, index) => ({ event, index, occurredAt: Date.parse(event.occurredAt) }))
    .sort((a, b) => {
      const aTime = Number.isFinite(a.occurredAt) ? a.occurredAt : 0;
      const bTime = Number.isFinite(b.occurredAt) ? b.occurredAt : 0;
      return bTime - aTime || a.index - b.index;
    })
    .map(({ event }) => event);
}

async function postBatch(config: TokenizerConfig, events: UsageEventInput[]) {
  // Diagnostics carry agentFeatureVersion: the server only trusts in-place
  // row corrections (parser v2 re-parses) from agents that declare it.
  const body: BatchUsageRequest = {
    device: deviceWithDiagnostics(),
    events: events.map((event) => minimizeUsageEvent(sanitizeUsageEventGit(event))),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  };
  const credentials = readCredentials();
  const response = await agentFetch(`${config.serverUrl.replace(/\/+$/, "")}/api/usage/events/batch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${credentials.deviceToken}`,
      "x-tokenizer-batch-protocol": USAGE_PARTIAL_ACK_PROTOCOL
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) {
    let error: { code?: unknown; row?: unknown } = {};
    try { error = await response.json() as typeof error; } catch { /* fixed local error below */ }
    throw new BatchHttpError(
      response.status,
      typeof error.code === "string" ? error.code : undefined,
      Number.isInteger(error.row) && (error.row as number) >= 0 ? error.row as number : undefined
    );
  }
  return response.json() as Promise<BatchResult>;
}

type BatchResolution = {
  accepted: UsageEventInput[];
  rejected: Array<{ event: UsageEventInput; code: string }>;
};

function partialResolution(batch: UsageEventInput[], result: BatchResult): BatchResolution | null {
  const hasPartialFields = result.protocol !== undefined || result.accepted !== undefined || result.rejected !== undefined;
  if (!hasPartialFields) return null;
  if (result.protocol !== USAGE_PARTIAL_ACK_PROTOCOL || !Array.isArray(result.accepted) || !Array.isArray(result.rejected)) {
    throw new Error("Invalid partial ACK response");
  }
  const resolved = new Set<number>();
  const acceptedEvents: UsageEventInput[] = [];
  for (const accepted of result.accepted) {
    if (!Number.isInteger(accepted.row) || accepted.row < 0 || accepted.row >= batch.length || resolved.has(accepted.row)) {
      throw new Error("Invalid partial ACK response");
    }
    const event = batch[accepted.row];
    if (accepted.source !== event.source || accepted.sourceEventId !== event.sourceEventId) {
      throw new Error("Invalid partial ACK response");
    }
    resolved.add(accepted.row);
    acceptedEvents.push(event);
  }
  const rejected: Array<{ event: UsageEventInput; code: string }> = [];
  for (const item of result.rejected) {
    if (!Number.isInteger(item.row) || item.row < 0 || item.row >= batch.length || resolved.has(item.row) ||
        typeof item.code !== "string" || !ROW_REJECTION_CODES.has(item.code)) {
      throw new Error("Invalid partial ACK response");
    }
    resolved.add(item.row);
    rejected.push({ event: batch[item.row], code: item.code });
  }
  if (resolved.size !== batch.length || result.received !== result.accepted.length) {
    throw new Error("Invalid partial ACK response");
  }
  return { accepted: acceptedEvents, rejected };
}

// Inputs are already admitted by collection or durable queue persistence.
// Collection path rules are not a retroactive deletion policy for that backlog.
export async function syncEvents(
  config: TokenizerConfig,
  events: UsageEventInput[],
  options: SyncEventsOptions = {}
): Promise<SyncEventsResult> {
  const privacy = effectivePrivacy(config);
  if (privacy.mode !== "sync") throw new Error(`Usage sync disabled by privacy mode: ${privacy.mode}`);
  // A large historical retry must not keep today's data behind thousands of
  // old duplicates. Server queries order by occurredAt, so wire order has no
  // presentation semantics; newest-first restores dashboard freshness early.
  const ordered = newestFirst(events.map(minimizeUsageEvent));
  const total = { inserted: 0, updated: 0, duplicates: 0, received: 0, deviceId: readDevice().id };
  let rejectedCount = 0;
  let remaining = [...ordered];
  let sentEmpty = ordered.length > 0;
  let batchLimit = BATCH_SIZE;
  while (remaining.length > 0 || !sentEmpty) {
    const batch = remaining.slice(0, batchLimit);
    if (batch.length === 0) sentEmpty = true;
    let result: BatchResult;
    try {
      result = await syncBatchWithRetry(config, batch);
    } catch (error) {
      if (error instanceof BatchHttpError && error.status === 400 && error.code === "invalid_json" && error.row === undefined) {
        if (batch.length > 1) {
          // A previous B06 server cannot identify structural JSON poison.
          // Narrow it without dropping rows; successful halves are ACKed
          // normally and only a proven singleton can be quarantined.
          batchLimit = Math.ceil(batch.length / 2);
          continue;
        }
        if (batch.length === 1) {
          try {
            const probe = await syncBatchWithRetry(config, []);
            partialResolution([], probe);
          } catch {
            // The same envelope/device fails without an event, so the row is
            // not proven bad. Keep it active and surface the original error.
            throw error;
          }
          const rejected = [{ event: batch[0], code: error.code }];
          resolveQueueEvents({ accepted: [], rejected });
          remaining.shift();
          rejectedCount += 1;
          batchLimit = BATCH_SIZE;
          await options.onBatchSynced?.({
            synced: ordered.length - remaining.length,
            total: ordered.length,
            remaining: [...remaining]
          });
          continue;
        }
      }
      if (!(error instanceof BatchHttpError) || error.status !== 400 || error.row === undefined ||
          !error.code || !ROW_REJECTION_CODES.has(error.code) || error.row >= batch.length) throw error;
      // Compatibility fallback for the previous B06 server: it rejects the
      // whole batch but identifies one permanent row. Quarantine it first,
      // checkpoint the still-live good rows, then retry without backoff.
      resolveQueueEvents({ accepted: [], rejected: [{ event: batch[error.row], code: error.code }] });
      remaining.splice(error.row, 1);
      rejectedCount += 1;
      batchLimit = BATCH_SIZE;
      await options.onBatchSynced?.({
        synced: ordered.length - remaining.length,
        total: ordered.length,
        remaining: [...remaining]
      });
      continue;
    }
    const resolution = partialResolution(batch, result) ?? { accepted: batch, rejected: [] };
    resolveQueueEvents(resolution);
    rejectedCount += resolution.rejected.length;
    total.inserted += result.inserted;
    total.updated += result.updated ?? 0;
    total.duplicates += result.duplicates;
    total.received += result.received;
    total.deviceId = result.deviceId ?? total.deviceId;
    remaining.splice(0, batch.length);
    batchLimit = BATCH_SIZE;
    await options.onBatchSynced?.({
      synced: ordered.length - remaining.length,
      total: ordered.length,
      remaining: [...remaining]
    });
  }
  return rejectedCount > 0 ? { ...total, rejected: rejectedCount } : total;
}

export function readDiagnostics(
  paths: { queue?: string; state?: string } = {}
): DeviceDiagnostics {
  const queueFile = paths.queue ?? queuePath;
  const stateFile = paths.state ?? statePath;
  let queueDepth = 0;
  try {
    if (existsSync(queueFile)) {
      const text = readFileSync(queueFile, "utf8");
      queueDepth = text.split(/\r?\n/).filter(Boolean).length;
    }
  } catch {
    /* leave at 0 — diagnostics are best-effort */
  }
  let lastSyncStatus: DeviceDiagnostics["lastSyncStatus"] = null;
  let harness: DeviceDiagnostics["harness"];
  try {
    if (existsSync(stateFile)) {
      const state = JSON.parse(readFileSync(stateFile, "utf8")) as Record<string, unknown>;
      const status = state.lastSyncStatus;
      if (status === "success" || status === "failed") lastSyncStatus = status;
      harness = parseHarnessSyncSnapshot(state.harness) ?? undefined;
    }
  } catch {
    /* corrupted state file shouldn't block heartbeat */
  }
  return {
    agentVersion: getAgentVersion(),
    agentReleaseVersion: CURRENT_AGENT_RELEASE_VERSION,
    agentFeatureVersion: AGENT_FEATURE_VERSION,
    queueDepth,
    // Detailed errors stay in local state/logs; exception messages can embed
    // parser input or server response text and are not safe default telemetry.
    lastError: null,
    lastSyncStatus,
    ...(harness ? { harness } : {})
  };
}

function deviceWithDiagnostics(): DeviceInput {
  return { ...readDevice(), diagnostics: readDiagnostics() };
}

export async function heartbeat(config: TokenizerConfig) {
  const mode = effectivePrivacy(config).mode;
  if (mode !== "sync") throw new Error(`Heartbeat disabled by privacy mode: ${mode}`);
  const credentials = readCredentials();
  const response = await agentFetch(`${config.serverUrl.replace(/\/+$/, "")}/api/devices/heartbeat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${credentials.deviceToken}`
    },
    body: JSON.stringify({
      device: deviceWithDiagnostics(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`Heartbeat failed: ${response.status} ${await response.text()}`);
  return response.json() as Promise<{ ok: boolean; deviceId: string; lastSeenAt: string }>;
}
