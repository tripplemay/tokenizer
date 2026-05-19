import { codexChatgptProvider } from "./codex-chatgpt";
import type { QuotaProvider, QuotaProviderError, QuotaSnapshotInput } from "./types";

// Default list. Tests pass an explicit array; production calls
// runConfiguredProviders() with no args and uses this.
const DEFAULT_PROVIDERS: QuotaProvider[] = [codexChatgptProvider];

export async function runConfiguredProviders(providers: QuotaProvider[] = DEFAULT_PROVIDERS): Promise<{
  snapshots: QuotaSnapshotInput[];
  errors: Record<string, QuotaProviderError>;
}> {
  const snapshots: QuotaSnapshotInput[] = [];
  const errors: Record<string, QuotaProviderError> = {};

  for (const provider of providers) {
    let configured: boolean;
    try {
      configured = await provider.isConfigured();
    } catch {
      configured = false;
    }
    if (!configured) continue;

    try {
      const result = await provider.fetch();
      if (result.error) {
        errors[provider.id] = result.error;
      }
      const accountKey = result.accountKey ?? "unknown";
      for (const snap of result.snapshots) {
        snapshots.push({ ...snap, accountKey });
      }
    } catch (err) {
      errors[provider.id] = {
        code: "fetch_threw",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return { snapshots, errors };
}
