import type { TokenizerConfig, TokenizerState } from "@/cli/config";
import { readState, updateState } from "@/cli/config";
import { runConfiguredProviders } from "./registry";
import { syncQuotaSnapshots } from "./sync";

// Single-flight gate — agent's tick scheduler may fire while a previous
// refresh is still in flight (slow chatgpt.com, sleep/wake races). Same
// pattern as the existing sync single-flight in agent.ts.
let inflight: Promise<void> | null = null;

export function runQuotaRefresh(config: TokenizerConfig): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { snapshots, errors } = await runConfiguredProviders();
      const errorEntries = Object.entries(errors);
      const at = new Date().toISOString();

      if (snapshots.length > 0) {
        await syncQuotaSnapshots(config, snapshots);
      }

      const quotaAuthErrors: Record<string, { code: number | string; lastFailedAt: string; consecutiveFailures: number }> = {};
      for (const [providerId, err] of errorEntries) {
        quotaAuthErrors[providerId] = { code: err.code, lastFailedAt: at, consecutiveFailures: 1 };
      }

      const prevState = readState();
      const merged = mergeQuotaAuthErrors(
        prevState.quotaAuthErrors,
        quotaAuthErrors,
        errorEntries.map(([id]) => id)
      );

      const patch: Partial<TokenizerState> = {
        lastQuotaRefreshAt: at,
        lastQuotaRefreshStatus: errorEntries.length === 0 ? "success" : "failed",
        ...(merged !== undefined ? { quotaAuthErrors: merged } : {}),
      };
      // Clear quotaAuthErrors when all providers recovered
      if (merged === undefined && prevState.quotaAuthErrors !== undefined) {
        updateState({ ...patch, quotaAuthErrors: undefined });
      } else {
        updateState(patch as Record<string, unknown>);
      }
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function mergeQuotaAuthErrors(
  prev: Record<string, { code: number | string; lastFailedAt: string; consecutiveFailures: number }> | undefined,
  current: Record<string, { code: number | string; lastFailedAt: string; consecutiveFailures: number }>,
  failedIds: string[]
) {
  const out = { ...(prev ?? {}) };
  for (const id of Object.keys(out)) {
    // Provider that failed before and is now succeeding gets cleared.
    if (!failedIds.includes(id)) delete out[id];
  }
  for (const [id, err] of Object.entries(current)) {
    const prior = prev?.[id];
    out[id] = {
      code: err.code,
      lastFailedAt: err.lastFailedAt,
      consecutiveFailures: (prior?.consecutiveFailures ?? 0) + 1,
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
