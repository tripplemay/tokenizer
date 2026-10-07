import { readCodexTotalUsage } from "@/shared/codex-usage";
import type { UsageEventInput } from "@/shared/usage";

// Codex cumulative counters are needed to canonicalize IDs from older agents.
// No other parser raw payload is needed for ingest or correction: corrected
// Claude usage/model/fallback values already live in the event's scalar fields.
export function minimalCodexRawJson(rawJson: unknown): unknown {
  const usage = readCodexTotalUsage(rawJson);
  if (!usage) return undefined;
  return {
    payload: {
      info: {
        total_token_usage: {
          input_tokens: usage.inputTokens,
          cached_input_tokens: usage.cachedInputTokens,
          cache_write_input_tokens: usage.cacheWriteTokens,
          output_tokens: usage.outputTokens,
          reasoning_output_tokens: usage.reasoningOutputTokens,
          total_tokens: usage.totalTokens
        }
      }
    }
  };
}

const EVENT_FIELDS = [
  "projectName",
  "sessionId",
  "workspacePath",
  "localWorkspacePath",
  "repoKey",
  "gitRemote",
  "gitBranch",
  "gitCommit",
  "model",
  "inputTokens",
  "outputTokens",
  "cachedInputTokens",
  "cacheWriteTokens",
  "reasoningOutputTokens",
  "totalTokens",
  "costUsd",
  "cacheEphemeral5mInputTokens",
  "cacheEphemeral1hInputTokens",
  "webSearchRequests",
  "webFetchRequests",
  "serviceTier",
  "fallbackFromModel",
  "fallbackToModel"
] as const satisfies ReadonlyArray<keyof UsageEventInput>;

export function minimizeUsageEvent(event: UsageEventInput): UsageEventInput {
  const safe: UsageEventInput = {
    source: event.source,
    sourceEventId: event.sourceEventId,
    occurredAt: event.occurredAt
  };
  for (const field of EVENT_FIELDS) {
    if (event[field] !== undefined) Object.assign(safe, { [field]: event[field] });
  }
  const rawJson = event.source === "codex" ? minimalCodexRawJson(event.rawJson) : undefined;
  if (rawJson !== undefined) safe.rawJson = rawJson;
  return safe;
}
