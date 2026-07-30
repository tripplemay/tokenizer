import { existsSync, readFileSync } from "node:fs";
import { writeFileAtomic } from "@/cli/atomic-file";
import { BatchUsageRequest, DeviceDiagnostics, DeviceInput, UsageEventInput } from "@/shared/usage";
import { queuePath, readCredentials, readDevice, statePath, TokenizerConfig } from "./config";
import { getAgentVersion } from "./agent-version";
import { AGENT_FEATURE_VERSION } from "@/shared/agent-feature-version";
import { agentFetch } from "./fetch";
import { parseHarnessSyncSnapshot } from "@/shared/harness-health";

export function readQueue(): UsageEventInput[] {
  if (!existsSync(queuePath)) return [];
  return readFileSync(queuePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as UsageEventInput);
}

export function clearQueue() {
  writeFileAtomic(queuePath, "");
}

// Batches are intentionally small. Each event includes the raw API response
// in rawJson, which for Claude messages with tool use can be 5–15 KB. 200
// events ≈ 600 KB–3 MB on the wire, safely under reverse-proxy body limits
// (nginx defaults to client_max_body_size 1m) while still amortising the
// per-request roundtrip cost.
const BATCH_SIZE = 200;
// Generous per-request timeout. After the macOS-sleep / wake fix, an
// in-flight fetch that was active when the host suspended often becomes
// permanently stuck — without a timeout, the agent will block forever on
// that orphan socket. 60s is enough for a healthy POST (sub-second on Phase
// 1's batched ingest) while guaranteeing a wake-up retry path.
const REQUEST_TIMEOUT_MS = 60_000;

export async function syncEvents(config: TokenizerConfig, events: UsageEventInput[]) {
  if (events.length > BATCH_SIZE) return syncEventsInBatches(config, events);
  // Diagnostics carry agentFeatureVersion: the server only trusts in-place
  // row corrections (parser v2 re-parses) from agents that declare it.
  const body: BatchUsageRequest = { device: deviceWithDiagnostics(), events, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  const credentials = readCredentials();
  const response = await agentFetch(`${config.serverUrl.replace(/\/+$/, "")}/api/usage/events/batch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${credentials.deviceToken}`
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`Sync failed: ${response.status} ${await response.text()}`);
  return response.json() as Promise<{ inserted: number; updated?: number; duplicates: number; received: number; deviceId?: string }>;
}

// A multi-batch run (especially the one-time parser-v2 backfill: 200+
// sequential batches) shouldn't abort on one transient network blip — the
// user's proxy path in particular drops the occasional request. Re-sending a
// batch is idempotent server-side (skipDuplicates + compare-equal
// corrections), so retry each batch a couple of times before giving up.
const BATCH_RETRY_DELAYS_MS = [5_000, 15_000];

async function syncBatchWithRetry(config: TokenizerConfig, batch: UsageEventInput[]) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await syncEvents(config, batch);
    } catch (error) {
      if (attempt >= BATCH_RETRY_DELAYS_MS.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, BATCH_RETRY_DELAYS_MS[attempt]));
    }
  }
}

async function syncEventsInBatches(config: TokenizerConfig, events: UsageEventInput[]) {
  const total = { inserted: 0, updated: 0, duplicates: 0, received: 0, deviceId: readDevice().id };
  for (let index = 0; index < events.length; index += BATCH_SIZE) {
    const result = await syncBatchWithRetry(config, events.slice(index, index + BATCH_SIZE));
    total.inserted += result.inserted;
    total.updated += result.updated ?? 0;
    total.duplicates += result.duplicates;
    total.received += result.received;
    total.deviceId = result.deviceId ?? total.deviceId;
  }
  return total;
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
  let lastError: string | null = null;
  let lastSyncStatus: DeviceDiagnostics["lastSyncStatus"] = null;
  let harness: DeviceDiagnostics["harness"];
  try {
    if (existsSync(stateFile)) {
      const state = JSON.parse(readFileSync(stateFile, "utf8")) as Record<string, unknown>;
      const err = state.lastError;
      lastError = typeof err === "string" && err.length ? err.slice(0, 500) : null;
      const status = state.lastSyncStatus;
      if (status === "success" || status === "failed") lastSyncStatus = status;
      harness = parseHarnessSyncSnapshot(state.harness) ?? undefined;
    }
  } catch {
    /* corrupted state file shouldn't block heartbeat */
  }
  return {
    agentVersion: getAgentVersion(),
    agentFeatureVersion: AGENT_FEATURE_VERSION,
    queueDepth,
    lastError,
    lastSyncStatus,
    ...(harness ? { harness } : {})
  };
}

function deviceWithDiagnostics(): DeviceInput {
  return { ...readDevice(), diagnostics: readDiagnostics() };
}

export async function heartbeat(config: TokenizerConfig) {
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
