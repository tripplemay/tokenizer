import Card from "@/components/card";
import { formatFullNumber, formatTokens, formatUsd } from "@/shared/format";
import { SourcePill } from "./source-pill";
import { ShareBar } from "./share-bar";
import { Sparkline } from "./sparkline";

type SourceRow = {
  name: string;
  billableTokens: number;
  totalTokens: number;
  cost: number;
  events: number;
};

const SPARK_COLORS: Record<string, string> = {
  "claude-code": "#FF6F61",
  codex: "#4318FF",
  opencode: "#01B574",
  aider: "#FFB547"
};

// 替代 Sources 表格 — 每个 source 一张卡,带:source 徽章 / 计算量 / 成本 /
// share 条 / 7-day sparkline。比纯文字表格更直观,留白也更舒服。
export function SourceCardGrid({
  rows,
  billableTotal,
  series,
  labels
}: {
  rows: SourceRow[];
  billableTotal: number;
  // dailyBySource: per-source array of daily input numbers, keyed by source name
  series: Array<{ name: string; data: number[] }>;
  labels: { compute: string; cost: string; events: string };
}) {
  if (rows.length === 0) return null;
  const seriesByName = new Map(series.map((s) => [s.name, s.data]));
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {rows.map((row) => {
        const data = seriesByName.get(row.name) ?? [];
        const color = SPARK_COLORS[row.name] ?? "#A3AED0";
        return (
          <Card key={row.name} extra="p-5 transition hover:-translate-y-0.5 hover:shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <SourcePill source={row.name} />
              <span className="text-xs font-medium text-gray-500">{formatFullNumber(row.events)} · {labels.events}</span>
            </div>
            <div className="text-2xl font-display font-bold tracking-tight text-navy-700 dark:text-white" title={`${formatFullNumber(row.billableTokens)} ${labels.compute}`}>
              {formatTokens(row.billableTokens)}
            </div>
            <div className="mt-1 text-sm font-medium text-gray-600 dark:text-gray-300">
              {row.cost > 0 ? formatUsd(row.cost) : "—"}
              <span className="ml-1.5 text-xs text-gray-500">{labels.cost}</span>
            </div>
            <div className="mt-3">
              <ShareBar value={row.billableTokens} total={billableTotal} width="w-full" colorHex={color} />
            </div>
            <div className="-mx-2 -mb-2 mt-3">
              <Sparkline data={data} color={color} height={40} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}
