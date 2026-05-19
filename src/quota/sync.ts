import type { TokenizerConfig } from "@/cli/config";
import { readCredentials } from "@/cli/config";
import { agentFetch } from "@/cli/fetch";
import type { QuotaSnapshotInput } from "./types";

const REQUEST_TIMEOUT_MS = 30_000;

export async function syncQuotaSnapshots(
  config: TokenizerConfig,
  snapshots: QuotaSnapshotInput[]
): Promise<{ received: number; inserted: number }> {
  if (snapshots.length === 0) return { received: 0, inserted: 0 };
  const credentials = readCredentials();
  const url = `${config.serverUrl.replace(/\/+$/, "")}/api/quota/snapshots/batch`;
  const response = await agentFetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${credentials.deviceToken}`,
    },
    body: JSON.stringify({ snapshots }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Quota sync failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as { received: number; inserted: number };
}
