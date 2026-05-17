export type UsageSource = "claude-code" | "codex" | "opencode" | "aider";

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
  cacheWriteTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
  costUsd?: number | null;
  occurredAt: string;
  rawJson?: unknown;
};

// Diagnostic info pushed by the agent on every heartbeat. All fields are
// optional so old clients still validate; the server treats missing fields
// as "no update" rather than overwriting with null.
export type DeviceDiagnostics = {
  agentVersion?: string | null;
  queueDepth?: number;
  lastError?: string | null;
  lastSyncStatus?: "success" | "failed" | null;
};

export type DeviceInput = {
  id: string;
  name: string;
  hostname?: string | null;
  platform?: string | null;
  metadata?: unknown;
  diagnostics?: DeviceDiagnostics;
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
