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
      const at = new Date().toISOString();

      if (snapshots.length > 0) {
        try {
          await syncQuotaSnapshots(config, snapshots);
        } catch (err) {
          // HTTP 5xx / timeout: record as a synthetic provider error so the
          // state-write below always proceeds and the dashboard footer reflects
          // the failure rather than showing a stale "refreshed Xs ago".
          errors["__sync__"] = { code: "sync_failed", message: err instanceof Error ? err.message : String(err) };
        }
      }

      const errorEntries = Object.entries(errors);

      // Intermediate map carries only the fields that originate from the
      // scrape layer; mergeQuotaAuthErrors is responsible for computing
      // consecutiveFailures from prior state, so we don't pre-seed it here.
      const quotaAuthErrors: Record<string, { code: number | string; lastFailedAt: string }> = {};
      for (const [providerId, err] of errorEntries) {
        quotaAuthErrors[providerId] = { code: err.code, lastFailedAt: at };
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
      // When all providers recovered, pass quotaAuthErrors: undefined.
      // updateState does { ...prev, ...patch } then JSON.stringify, and
      // JSON.stringify drops undefined-valued keys, so the key is cleanly
      // removed from state.json on disk — stale errors do NOT persist.
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
  current: Record<string, { code: number | string; lastFailedAt: string }>,
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
