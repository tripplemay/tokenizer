"use client";

import { useTranslations } from "next-intl";
import BarChart from "@/components/charts/BarChart";
import LineChart from "@/components/charts/LineChart";
import { chartTypeVisuals } from "@/shared/chart-type";
import { formatTokens } from "@/shared/format";
import { ChartTypeToggle } from "./_components/chart-type-toggle";
import { useChartType } from "./_components/use-chart-type";

type DailyRow = {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  billableTokens: number;
};

// When granularity is supplied (model detail page), buckets may be sub-day and
// the date string carries an hour ("2026-06-10T08:00"). We parse those into UTC
// timestamps so the datetime axis positions them correctly, and label tooltips
// down to the hour. Omitting the prop preserves the original daily behaviour for
// the dashboard and device pages.
type Granularity = "hour" | "day" | "week";

const INPUT_COLOR = "#4318FF";
const OUTPUT_COLOR = "#6AD2FF";

// Bucket key -> UTC timestamp. The key already encodes the user's wall clock, so
// reading it as UTC makes the datetime axis render that exact wall clock.
function bucketToTs(date: string, granularity: Granularity): number {
  return Date.parse(granularity === "hour" ? `${date}:00Z` : `${date}T00:00:00Z`);
}

function labelForTs(ts: number, granularity: Granularity): string {
  const iso = new Date(ts).toISOString();
  return granularity === "hour" ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

export function DailyUsageChart({ data, granularity }: { data: DailyRow[]; granularity?: Granularity }) {
  const t = useTranslations("chart");
  const [chartType, setChartType] = useChartType("daily-usage");
  const visuals = chartTypeVisuals(chartType);

  const toX = (d: DailyRow) => (granularity ? bucketToTs(d.date, granularity) : d.date);
  const series = [
    { name: t("input"), data: data.map((d) => ({ x: toX(d), y: d.inputTokens })) },
    { name: t("output"), data: data.map((d) => ({ x: toX(d), y: d.outputTokens })) }
  ];

  function tooltipHtml(date: string, input: number, output: number): string {
    return `
      <div class="duc-tooltip">
        <div class="duc-tooltip-title">${date}</div>
        <div class="duc-tooltip-row">
          <span class="duc-tooltip-label">
            <span class="duc-tooltip-dot" style="background:${INPUT_COLOR}"></span>${t("input")}
          </span>
          <span class="duc-tooltip-value">${formatTokens(input)}</span>
        </div>
        <div class="duc-tooltip-row">
          <span class="duc-tooltip-label">
            <span class="duc-tooltip-dot" style="background:${OUTPUT_COLOR}"></span>${t("output")}
          </span>
          <span class="duc-tooltip-value">${formatTokens(output)}</span>
        </div>
      </div>
    `;
  }

  const options = {
    chart: {
      type: visuals.apexType,
      toolbar: { show: false },
      zoom: { enabled: false },
      fontFamily: "DM Sans, sans-serif",
      stacked: visuals.stacked
    },
    legend: { show: true, position: "top" as const, horizontalAlign: "right" as const, labels: { colors: "#A3AED0" } },
    dataLabels: { enabled: false },
    stroke: visuals.stroke,
    colors: [INPUT_COLOR, OUTPUT_COLOR],
    fill: visuals.fill,
    ...(visuals.plotOptions ? { plotOptions: visuals.plotOptions } : {}),
    xaxis: {
      type: "datetime" as const,
      labels: { style: { colors: "#A3AED0", fontSize: "12px", fontWeight: "500" } },
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    // Dual Y axes: Input on the left (huge values once cache reuse is included),
    // Output on the right (smaller scale). Each gets its own range so neither
    // series collapses against the other.
    yaxis: [
      {
        labels: {
          style: { colors: INPUT_COLOR, fontSize: "12px", fontWeight: "500" },
          formatter: (val: number) => formatTokens(val)
        },
        title: { text: t("input"), style: { color: INPUT_COLOR, fontWeight: "600" } },
        axisBorder: { show: false },
        axisTicks: { show: false }
      },
      {
        opposite: true,
        labels: {
          style: { colors: OUTPUT_COLOR, fontSize: "12px", fontWeight: "500" },
          formatter: (val: number) => formatTokens(val)
        },
        title: { text: t("output"), style: { color: OUTPUT_COLOR, fontWeight: "600" } },
        axisBorder: { show: false },
        axisTicks: { show: false }
      }
    ],
    grid: { borderColor: "#E0E5F2", strokeDashArray: 5 },
    tooltip: {
      enabled: true,
      shared: true,
      intersect: false,
      custom: ({ series: s, dataPointIndex, w }: { series: number[][]; dataPointIndex: number; w: { globals: { seriesX: number[][] } } }) => {
        const xRaw = w.globals.seriesX?.[0]?.[dataPointIndex];
        const date = xRaw ? (granularity ? labelForTs(Number(xRaw), granularity) : new Date(xRaw).toISOString().slice(0, 10)) : "";
        const input = Number(s[0]?.[dataPointIndex] ?? 0);
        const output = Number(s[1]?.[dataPointIndex] ?? 0);
        return tooltipHtml(date, input, output);
      }
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-1 flex justify-end">
        <ChartTypeToggle value={chartType} onChange={setChartType} />
      </div>
      <div className="min-h-0 flex-1">
        {chartType === "bar" ? (
          <BarChart chartData={series} chartOptions={options} />
        ) : (
          <LineChart chartData={series} chartOptions={options} />
        )}
      </div>
    </div>
  );
}
