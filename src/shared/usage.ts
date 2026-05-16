export type UsageSource = "claude-code" | "codex" | "opencode";

export type UsageEventInput = {
  source: UsageSource;
  sourceEventId: string;
  projectName?: string | null;
  sessionId?: string | null;
  workspacePath?: string | null;
  localWorkspacePath?: string | null;
  repoKey?: string | null;
  gitRemote?: string | null;
  gitBranch?: string | null;
  gitCommit?: string | null;
  model?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
  costUsd?: number | null;
  occurredAt: string;
  rawJson?: unknown;
};

export type DeviceInput = {
  id: string;
  name: string;
  hostname?: string | null;
  platform?: string | null;
  metadata?: unknown;
};

export type BatchUsageRequest = {
  device?: DeviceInput;
  events: UsageEventInput[];
};

export function normalizeTokenCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.trunc(parsed));
  }
  return 0;
}

export function computeTotalTokens(event: Pick<UsageEventInput, "inputTokens" | "outputTokens" | "totalTokens">): number {
  const explicit = normalizeTokenCount(event.totalTokens);
  if (explicit > 0) return explicit;
  return normalizeTokenCount(event.inputTokens) + normalizeTokenCount(event.outputTokens);
}
