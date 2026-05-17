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
