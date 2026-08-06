import { normalizeTokenCount } from "@/shared/usage";

export const CODEX_USAGE_FIELDS = [
  "input_tokens",
  "cached_input_tokens",
  "cache_write_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens"
] as const;

export type CodexUsageCounters = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeCodexUsage(value: unknown): CodexUsageCounters {
  const usage = isRecord(value) ? value : {};
  return {
    inputTokens: normalizeTokenCount(usage.input_tokens),
    cachedInputTokens: normalizeTokenCount(usage.cached_input_tokens),
    cacheWriteTokens: normalizeTokenCount(usage.cache_write_input_tokens),
    outputTokens: normalizeTokenCount(usage.output_tokens),
    reasoningOutputTokens: normalizeTokenCount(usage.reasoning_output_tokens),
    totalTokens: normalizeTokenCount(usage.total_tokens)
  };
}

export function hasCodexUsage(usage: CodexUsageCounters): boolean {
  return (
    usage.inputTokens > 0 ||
    usage.cachedInputTokens > 0 ||
    usage.cacheWriteTokens > 0 ||
    usage.outputTokens > 0 ||
    usage.reasoningOutputTokens > 0 ||
    usage.totalTokens > 0
  );
}

export function readCodexTotalUsage(rawJson: unknown): CodexUsageCounters | null {
  if (!isRecord(rawJson)) return null;
  const payload = rawJson.payload;
  if (!isRecord(payload) || !isRecord(payload.info)) return null;
  const total = payload.info.total_token_usage;
  if (!isRecord(total) || !("total_tokens" in total)) return null;
  const normalized = normalizeCodexUsage(total);
  return hasCodexUsage(normalized) ? normalized : null;
}

export function positiveCodexDelta(current: CodexUsageCounters, previous: CodexUsageCounters): CodexUsageCounters {
  return {
    inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
    cachedInputTokens: Math.max(0, current.cachedInputTokens - previous.cachedInputTokens),
    cacheWriteTokens: Math.max(0, current.cacheWriteTokens - previous.cacheWriteTokens),
    outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
    reasoningOutputTokens: Math.max(0, current.reasoningOutputTokens - previous.reasoningOutputTokens),
    totalTokens: Math.max(0, current.totalTokens - previous.totalTokens)
  };
}

export function maxCodexUsage(left: CodexUsageCounters, right: CodexUsageCounters): CodexUsageCounters {
  return {
    inputTokens: Math.max(left.inputTokens, right.inputTokens),
    cachedInputTokens: Math.max(left.cachedInputTokens, right.cachedInputTokens),
    cacheWriteTokens: Math.max(left.cacheWriteTokens, right.cacheWriteTokens),
    outputTokens: Math.max(left.outputTokens, right.outputTokens),
    reasoningOutputTokens: Math.max(left.reasoningOutputTokens, right.reasoningOutputTokens),
    totalTokens: Math.max(left.totalTokens, right.totalTokens)
  };
}

const SAFE_SESSION_ID = /^[A-Za-z0-9._-]+$/;

export function codexCanonicalSourceEventId(sessionId: unknown, rawJson: unknown, fallback: string): string {
  if (typeof sessionId !== "string" || !SAFE_SESSION_ID.test(sessionId)) return fallback;
  const total = readCodexTotalUsage(rawJson);
  if (!total) return fallback;
  return [
    "codex:v2",
    sessionId,
    total.inputTokens,
    total.cachedInputTokens,
    total.cacheWriteTokens,
    total.outputTokens,
    total.reasoningOutputTokens,
    total.totalTokens
  ].join(":");
}
