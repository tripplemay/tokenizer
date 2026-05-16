import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { BatchUsageRequest, UsageEventInput } from "@/shared/usage";
import { queuePath, readCredentials, readDevice, TokenizerConfig } from "./config";

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

export async function syncEvents(config: TokenizerConfig, events: UsageEventInput[]) {
  if (events.length > 500) return syncEventsInBatches(config, events);
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
  const batchSize = 500;
  const total = { inserted: 0, duplicates: 0, received: 0, deviceId: readDevice().id };
  for (let index = 0; index < events.length; index += batchSize) {
    const result = await syncEvents(config, events.slice(index, index + batchSize));
    total.inserted += result.inserted;
    total.duplicates += result.duplicates;
    total.received += result.received;
    total.deviceId = result.deviceId ?? total.deviceId;
  }
  return total;
}

export async function heartbeat(config: TokenizerConfig) {
  const credentials = readCredentials();
  const response = await fetch(`${config.serverUrl.replace(/\/+$/, "")}/api/devices/heartbeat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${credentials.deviceToken}`
    },
    body: JSON.stringify({ device: readDevice() })
  });
  if (!response.ok) throw new Error(`Heartbeat failed: ${response.status} ${await response.text()}`);
  return response.json() as Promise<{ ok: boolean; deviceId: string; lastSeenAt: string }>;
}
