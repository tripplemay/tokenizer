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
  cacheEphemeral5mInputTokens?: number;
  cacheEphemeral1hInputTokens?: number;
  webSearchRequests?: number;
  webFetchRequests?: number;
  serviceTier?: string | null;
  // Set when this event is one side of a mid-request model fallback (e.g.
  // claude-fable-5 downgrading to claude-opus-4-8). The final event carries
  // fallbackFromModel; the abandoned-segment event carries fallbackToModel.
  fallbackFromModel?: string | null;
  fallbackToModel?: string | null;
  occurredAt: string;
  rawJson?: unknown;
};

// Diagnostic info pushed by the agent on every heartbeat. All fields are
// optional so old clients still validate; the server treats missing fields
// as "no update" rather than overwriting with null.
export type DeviceDiagnostics = {
  agentVersion?: string | null;
  // Numeric capability version; lets the server compare with a simple
  // `featureVersion < MIN` without enumerating git SHAs. See
  // src/shared/agent-feature-version.ts for the bump policy.
  agentFeatureVersion?: number | null;
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
  timezone?: string;
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
