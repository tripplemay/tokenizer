// BL-AGENT-LATENCY F002：daemon 模式 harness 轮询的错误驱动退避（纯函数）。
// 清洁轮固定 60s；出问题后指数退避封顶 600s，防止服务端故障期每分钟重撞；
// 抖动打散多设备同拍。non-retryable 的 issue 同样退避——它们短期内重试也
// 不会变好。cron 模式（runOnce）节拍由 crontab 决定，不经过这里。

export const HARNESS_BASE_MS = 60_000;
export const HARNESS_MAX_MS = 600_000;
export const HARNESS_JITTER_MIN = 0.85;
export const HARNESS_JITTER_SPAN = 0.3;

export interface HarnessBackoffState {
  readonly consecutiveFailures: number;
}

export const initialHarnessBackoff: HarnessBackoffState = { consecutiveFailures: 0 };

export function nextHarnessBackoff(
  state: HarnessBackoffState,
  hadIssues: boolean,
  random: () => number = Math.random
): { state: HarnessBackoffState; delayMs: number } {
  if (!hadIssues) return { state: initialHarnessBackoff, delayMs: HARNESS_BASE_MS };
  const consecutiveFailures = state.consecutiveFailures + 1;
  const capped = Math.min(HARNESS_BASE_MS * 2 ** consecutiveFailures, HARNESS_MAX_MS);
  const jitter = HARNESS_JITTER_MIN + random() * HARNESS_JITTER_SPAN;
  return { state: { consecutiveFailures }, delayMs: Math.round(capped * jitter) };
}
