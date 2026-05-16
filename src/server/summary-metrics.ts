export type SummaryRawTotals = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

export type SummaryMetrics = {
  billableTokens: number;
  cacheHitRate: number;
};

function clamp(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function computeSummaryMetrics(raw: SummaryRawTotals): SummaryMetrics {
  const input = clamp(raw.inputTokens);
  const output = clamp(raw.outputTokens);
  const cached = clamp(raw.cachedInputTokens);
  const cacheBase = input + cached;
  return {
    billableTokens: input + output,
    cacheHitRate: cacheBase > 0 ? cached / cacheBase : 0
  };
}
