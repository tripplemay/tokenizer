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
