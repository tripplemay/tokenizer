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
  if (!value) return "No data";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "No data";
  return date.toISOString().replace("T", " ").slice(0, 16);
}
