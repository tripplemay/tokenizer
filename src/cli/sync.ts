import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { BatchUsageRequest, UsageEventInput } from "@/shared/usage";
import { queuePath, TokenizerConfig } from "./config";

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
  if (events.length === 0) return { inserted: 0, duplicates: 0, received: 0 };
  const body: BatchUsageRequest = { events };
  const response = await fetch(`${config.serverUrl.replace(/\/+$/, "")}/api/usage/events/batch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.apiKey
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Sync failed: ${response.status} ${await response.text()}`);
  return response.json() as Promise<{ inserted: number; duplicates: number; received: number }>;
}
