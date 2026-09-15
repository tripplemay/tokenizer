import type { QuotaLatestProvider } from "@/server/quota";

export const QUOTA_FRESHNESS_MS = 15 * 60 * 1000;

const WINDOW_UNITS = [
  ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60], ["second", 1]
] as const;

export function getQuotaWindowDuration(rawJson: unknown): { unit: typeof WINDOW_UNITS[number][0]; value: number } | null {
  if (rawJson == null || typeof rawJson !== "object" || Array.isArray(rawJson)) return null;
  const raw = rawJson as Record<string, unknown>;
  const validSeconds = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  const legacySeconds = typeof raw.window_minutes === "number" ? raw.window_minutes * 60 : null;
  const seconds = validSeconds(raw.limit_window_seconds) ? raw.limit_window_seconds : legacySeconds;
  if (!validSeconds(seconds)) return null;
  // Keep exact periods: 90 minutes must not be rounded to one or two hours.
  for (const [unit, size] of WINDOW_UNITS) {
    if (seconds % size === 0) return { unit, value: seconds / size };
  }
  return null;
}

export function parseQuotaTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) {
    return null;
  }
  const timestamp = Date.parse(value);
  const calendarDay = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || !Number.isFinite(calendarDay.getTime()) || !calendarDay.toISOString().startsWith(value.slice(0, 10))) {
    return null;
  }
  return timestamp;
}

export function orderQuotaAccounts(accounts: QuotaLatestProvider[], now: number): QuotaLatestProvider[] {
  const reportedAt = (account: QuotaLatestProvider) => {
    const timestamp = parseQuotaTimestamp(account.capturedAt);
    return timestamp != null && timestamp <= now ? timestamp : -Infinity;
  };
  return [...accounts].sort((a, b) => {
    const aTime = reportedAt(a);
    const bTime = reportedAt(b);
    if (aTime !== bTime) return aTime > bTime ? -1 : 1;
    return a.accountKey < b.accountKey ? -1 : a.accountKey > b.accountKey ? 1 : 0;
  });
}

export function getQuotaFreshness(
  window: { capturedAt?: unknown; resetsAt?: unknown },
  now: number
) {
  const reportedAt = parseQuotaTimestamp(window.capturedAt);
  const capturedAt = reportedAt != null && reportedAt <= now ? reportedAt : null;
  const resetsAt = parseQuotaTimestamp(window.resetsAt);
  const pendingRefresh = capturedAt == null || now - capturedAt > QUOTA_FRESHNESS_MS ||
    (window.resetsAt != null && (resetsAt == null || resetsAt <= now));
  return { capturedAt, resetsAt, pendingRefresh };
}

export function getQuotaRemaining(utilization: unknown, pendingRefresh: boolean): number | null {
  if (pendingRefresh || typeof utilization !== "number" || !Number.isFinite(utilization) || utilization < 0 || utilization > 1) {
    return null;
  }
  return 100 - Math.round(utilization * 100);
}

export function formatQuotaTimestamp(timestamp: number, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short"
  }).format(timestamp);
}
