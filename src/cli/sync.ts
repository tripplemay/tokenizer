import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { BatchUsageRequest, DeviceDiagnostics, DeviceInput, UsageEventInput } from "@/shared/usage";
import { queuePath, readCredentials, readDevice, statePath, TokenizerConfig } from "./config";
import { getAgentVersion } from "./agent-version";

export function readQueue(): UsageEventInput[] {
  if (!existsSync(queuePath)) return [];
  return readFileSync(queuePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as UsageEventInput);
}

export function clearQueue() {
  writeFileSync(queuePath, "");
}

// Batches are intentionally small. Each event includes the raw API response
// in rawJson, which for Claude messages with tool use can be 5–15 KB. 200
// events ≈ 600 KB–3 MB on the wire, safely under reverse-proxy body limits
// (nginx defaults to client_max_body_size 1m) while still amortising the
// per-request roundtrip cost.
const BATCH_SIZE = 200;

export async function syncEvents(config: TokenizerConfig, events: UsageEventInput[]) {
  if (events.length > BATCH_SIZE) return syncEventsInBatches(config, events);
  const body: BatchUsageRequest = { device: readDevice(), events };
  const credentials = readCredentials();
  const response = await fetch(`${config.serverUrl.replace(/\/+$/, "")}/api/usage/events/batch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${credentials.deviceToken}`
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Sync failed: ${response.status} ${await response.text()}`);
  return response.json() as Promise<{ inserted: number; duplicates: number; received: number; deviceId?: string }>;
}

async function syncEventsInBatches(config: TokenizerConfig, events: UsageEventInput[]) {
  const total = { inserted: 0, duplicates: 0, received: 0, deviceId: readDevice().id };
  for (let index = 0; index < events.length; index += BATCH_SIZE) {
    const result = await syncEvents(config, events.slice(index, index + BATCH_SIZE));
    total.inserted += result.inserted;
    total.duplicates += result.duplicates;
    total.received += result.received;
    total.deviceId = result.deviceId ?? total.deviceId;
  }
  return total;
}

function readDiagnostics(): DeviceDiagnostics {
  let queueDepth = 0;
  try {
    if (existsSync(queuePath)) {
      const text = readFileSync(queuePath, "utf8");
      queueDepth = text.split(/\r?\n/).filter(Boolean).length;
    }
  } catch {
    /* leave at 0 — diagnostics are best-effort */
  }
  let lastError: string | null = null;
  let lastSyncStatus: DeviceDiagnostics["lastSyncStatus"] = null;
  try {
    if (existsSync(statePath)) {
      const state = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
      const err = state.lastError;
      lastError = typeof err === "string" && err.length ? err.slice(0, 500) : null;
      const status = state.lastSyncStatus;
      if (status === "success" || status === "failed") lastSyncStatus = status;
    }
  } catch {
    /* corrupted state file shouldn't block heartbeat */
  }
  return {
    agentVersion: getAgentVersion(),
    queueDepth,
    lastError,
    lastSyncStatus
  };
}

function deviceWithDiagnostics(): DeviceInput {
  return { ...readDevice(), diagnostics: readDiagnostics() };
}

export async function heartbeat(config: TokenizerConfig) {
  const credentials = readCredentials();
  const response = await fetch(`${config.serverUrl.replace(/\/+$/, "")}/api/devices/heartbeat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${credentials.deviceToken}`
    },
    body: JSON.stringify({ device: deviceWithDiagnostics() })
  });
  if (!response.ok) throw new Error(`Heartbeat failed: ${response.status} ${await response.text()}`);
  return response.json() as Promise<{ ok: boolean; deviceId: string; lastSeenAt: string }>;
}
