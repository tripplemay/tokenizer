export const HARNESS_SYNC_ISSUE_LIMIT = 20;
export const HARNESS_PROJECT_LIMIT = 200;
export const HARNESS_CODE_LIMIT = 64;
export const HARNESS_SYNC_STALE_MS = 3 * 60 * 1000;

export const HARNESS_SYNC_OPERATIONS = ["report", "applied_ack", "mode_intent", "relay"] as const;
export const HARNESS_SYNC_STATUSES = ["idle", "success", "degraded", "failed"] as const;

export type HarnessSyncOperation = (typeof HARNESS_SYNC_OPERATIONS)[number];
export type HarnessSyncStatus = (typeof HARNESS_SYNC_STATUSES)[number];

export type HarnessSyncIssue = {
  operation: HarnessSyncOperation;
  project: string | null;
  code: string;
  retryable: boolean;
};

export type HarnessSyncSnapshot = {
  attemptedAt: string;
  status: HarnessSyncStatus;
  reported: number;
  failed: number;
  relayed: number;
  modeIntents: number;
  issues: HarnessSyncIssue[];
};

export type HarnessSyncDiagnostics = Pick<
  HarnessSyncSnapshot,
  "reported" | "failed" | "relayed" | "modeIntents" | "issues"
>;

export type HarnessHealthKey = HarnessSyncStatus | "stale" | "not-reported";

export const HARNESS_HEALTH_COLOR: Record<HarnessHealthKey, string> = {
  idle: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300",
  success: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300",
  degraded: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  stale: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300",
  "not-reported": "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300"
};

const SAFE_CODE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const UNSAFE_PROJECT = /[\\/?#\u0000-\u001f\u007f]/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isSafeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isUtcIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

export function safeHarnessCode(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > HARNESS_CODE_LIMIT) return null;
  return SAFE_CODE.test(value) ? value : null;
}

export function safeHarnessProject(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const project = value.slice(0, HARNESS_PROJECT_LIMIT);
  if (!project || UNSAFE_PROJECT.test(project)) return null;
  return project;
}

export function parseHarnessSyncIssue(value: unknown): HarnessSyncIssue | null {
  if (!isRecord(value) || !hasExactKeys(value, ["operation", "project", "code", "retryable"])) return null;
  if (!HARNESS_SYNC_OPERATIONS.includes(value.operation as HarnessSyncOperation)) return null;
  if (value.project !== null && safeHarnessProject(value.project) !== value.project) return null;
  const code = safeHarnessCode(value.code);
  if (!code || typeof value.retryable !== "boolean") return null;
  return {
    operation: value.operation as HarnessSyncOperation,
    project: value.project as string | null,
    code,
    retryable: value.retryable
  };
}

function parseHarnessSyncDiagnostics(value: unknown): HarnessSyncDiagnostics | null {
  if (!isRecord(value) || !hasExactKeys(value, ["reported", "failed", "relayed", "modeIntents", "issues"])) {
    return null;
  }
  if (
    !isSafeCount(value.reported) ||
    !isSafeCount(value.failed) ||
    !isSafeCount(value.relayed) ||
    !isSafeCount(value.modeIntents) ||
    !Array.isArray(value.issues) ||
    value.issues.length > HARNESS_SYNC_ISSUE_LIMIT
  ) {
    return null;
  }
  const issues = value.issues.map(parseHarnessSyncIssue);
  if (issues.some((issue) => issue === null)) return null;
  return {
    reported: value.reported,
    failed: value.failed,
    relayed: value.relayed,
    modeIntents: value.modeIntents,
    issues: issues as HarnessSyncIssue[]
  };
}

export function parseHarnessSyncSnapshot(value: unknown): HarnessSyncSnapshot | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["attemptedAt", "status", "reported", "failed", "relayed", "modeIntents", "issues"]) ||
    !isUtcIsoTimestamp(value.attemptedAt) ||
    !HARNESS_SYNC_STATUSES.includes(value.status as HarnessSyncStatus)
  ) {
    return null;
  }
  const diagnostics = parseHarnessSyncDiagnostics({
    reported: value.reported,
    failed: value.failed,
    relayed: value.relayed,
    modeIntents: value.modeIntents,
    issues: value.issues
  });
  if (!diagnostics) return null;
  return {
    attemptedAt: value.attemptedAt,
    status: value.status as HarnessSyncStatus,
    ...diagnostics
  };
}

export function harnessDiagnosticsFromSnapshot(snapshot: HarnessSyncSnapshot): HarnessSyncDiagnostics {
  return {
    reported: snapshot.reported,
    failed: snapshot.failed,
    relayed: snapshot.relayed,
    modeIntents: snapshot.modeIntents,
    issues: snapshot.issues
  };
}

export function harnessSnapshotFromPersisted(
  attemptedAt: Date | string | null | undefined,
  status: string | null | undefined,
  diagnostics: unknown
): HarnessSyncSnapshot | null {
  const timestamp = attemptedAt instanceof Date ? attemptedAt.toISOString() : attemptedAt;
  return parseHarnessSyncSnapshot({ attemptedAt: timestamp, status, ...(isRecord(diagnostics) ? diagnostics : {}) });
}

export function harnessHealthKey(
  status: string | null | undefined,
  attemptedAt: Date | string | null | undefined,
  nowMs: number
): HarnessHealthKey {
  const timestamp = attemptedAt instanceof Date ? attemptedAt.toISOString() : attemptedAt;
  if (!isUtcIsoTimestamp(timestamp) || !HARNESS_SYNC_STATUSES.includes(status as HarnessSyncStatus)) {
    return "not-reported";
  }
  if (nowMs - Date.parse(timestamp) > HARNESS_SYNC_STALE_MS) return "stale";
  return status as HarnessSyncStatus;
}

export function harnessHealthBadge(
  status: string | null | undefined,
  attemptedAt: Date | string | null | undefined,
  nowMs: number
): { key: HarnessHealthKey; color: string } {
  const key = harnessHealthKey(status, attemptedAt, nowMs);
  return { key, color: HARNESS_HEALTH_COLOR[key] };
}
