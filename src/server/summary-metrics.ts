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

// Under the new semantic, inputTokens is the total input the model saw
// (raw + cache write + cache read). billableTokens reflects the "new
// work" the model performed — total input minus cache reads, plus output.
// cacheHitRate is simply cached / total_input.
export function computeSummaryMetrics(raw: SummaryRawTotals): SummaryMetrics {
  const input = clamp(raw.inputTokens);
  const output = clamp(raw.outputTokens);
  const cached = clamp(raw.cachedInputTokens);
  const freshInput = Math.max(0, input - cached);
  return {
    billableTokens: freshInput + output,
    cacheHitRate: input > 0 ? Math.min(1, cached / input) : 0
  };
}
