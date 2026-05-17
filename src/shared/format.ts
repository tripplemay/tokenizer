const REPORTING_TIMEZONE = "Asia/Shanghai";

const dateTimeFmt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: REPORTING_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

const dateTimeSecondsFmt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: REPORTING_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

export function formatFullNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatCompactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs < 10_000) return formatFullNumber(value);

  const units = [
    { value: 1_000_000_000, suffix: "B" },
    { value: 1_000_000, suffix: "M" },
    { value: 1_000, suffix: "K" }
  ];

  const unit = units.find((item) => abs >= item.value);
  if (!unit) return formatFullNumber(value);

  const compact = value / unit.value;
  const rounded = compact.toFixed(1).replace(/\.0$/, "");
  return `${rounded}${unit.suffix}`;
}

export function formatTokens(value: number): string {
  return formatCompactNumber(value);
}

export function formatPercent(numerator: number, denominator: number): string {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return "0.0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

// USD formatter. Sub-dollar values keep three decimal places so a model with
// $0.0035 of usage doesn't round down to "$0.00"; once we're above $1 we drop
// to two decimals to match conventional currency display.
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00";
  const abs = Math.abs(value);
  if (abs >= 1) return `$${value.toFixed(2)}`;
  if (abs >= 0.01) return `$${value.toFixed(3)}`;
  if (value === 0) return "$0.00";
  return `$${value.toFixed(4)}`;
}

// Week-over-week delta. Returns null for "no prior baseline" so the caller can
// render "—" instead of a misleading 0% or Infinity.
export function formatWowDelta(current: number, previous: number): { text: string; direction: "up" | "down" | "flat" } | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  const ratio = (current - previous) / previous;
  const pct = ratio * 100;
  const direction = pct > 0.1 ? "up" : pct < -0.1 ? "down" : "flat";
  const sign = direction === "up" ? "+" : direction === "down" ? "" : "±";
  return { text: `${sign}${pct.toFixed(1)}%`, direction };
}

// Relative time helper for "5 分钟前" / "2 小时前" style display. Falls back to
// the absolute date for anything older than ~24h since relative time stops
// being precise enough beyond that.
export function formatRelativeTime(value: Date | string | null | undefined, t: (key: string, values?: Record<string, string | number>) => string): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return formatDateTime(date);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return t("relative.justNow");
  const min = Math.floor(sec / 60);
  if (min < 60) return t("relative.minutesAgo", { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("relative.hoursAgo", { n: hr });
  return formatDateTime(date);
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return dateTimeFmt.format(date);
}

export function formatDateTimeSeconds(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return dateTimeSecondsFmt.format(date);
}
