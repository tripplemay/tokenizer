// Horizontal bar + numeric label visualising a row's share of the table
// total. Used in Project Ranking + Models breakdown to replace the
// plain "12.3%" text cell with something the eye can compare row-to-row
// without parsing digits.

export function ShareBar({
  value,
  total,
  width = "w-20",
  colorHex
}: {
  value: number;
  total: number;
  width?: string;
  // Hex / CSS colour applied via inline style so per-row colours computed
  // at runtime (e.g. per source) don't need Tailwind JIT support.
  colorHex?: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;
  return (
    <div className="inline-flex items-center justify-end gap-2">
      <div className={`h-1.5 ${width} overflow-hidden rounded-full bg-gray-200/80 dark:bg-white/10`}>
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: colorHex ?? "#4318FF" }}
        />
      </div>
      <span className="w-12 text-right text-xs tabular-nums text-gray-600 dark:text-gray-300">{pct.toFixed(1)}%</span>
    </div>
  );
}
