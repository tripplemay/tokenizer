"use client";

import dynamic from "next/dynamic";
import { formatTokens } from "@/shared/format";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

type SeriesItem = { name: string; data: number[] };

// Brand-ish accent colours per source. Falls back to a neutral palette if a
// new source shows up.
const SOURCE_COLORS: Record<string, string> = {
  "claude-code": "#FF6F61",
  codex: "#4318FF",
  opencode: "#01B574"
};
const FALLBACK_PALETTE = ["#FFB547", "#6AD2FF", "#A3AED0", "#FF5630"];

export function DailySourceChart({ dates, series }: { dates: string[]; series: SeriesItem[] }) {
  const colors = series.map((s, i) => SOURCE_COLORS[s.name] ?? FALLBACK_PALETTE[i % FALLBACK_PALETTE.length]);

  const options = {
    chart: {
      type: "area" as const,
      toolbar: { show: false },
      zoom: { enabled: false },
      fontFamily: "DM Sans, sans-serif",
      stacked: true
    },
    legend: { show: true, position: "top" as const, horizontalAlign: "right" as const, labels: { colors: "#A3AED0" } },
    dataLabels: { enabled: false },
    stroke: { curve: "smooth" as const, width: 2 },
    colors,
    fill: {
      type: "gradient",
      gradient: { shadeIntensity: 1, opacityFrom: 0.55, opacityTo: 0.1, stops: [0, 100] }
    },
    xaxis: {
      type: "datetime" as const,
      categories: dates,
      labels: { style: { colors: "#A3AED0", fontSize: "12px", fontWeight: "500" } },
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    yaxis: {
      labels: {
        style: { colors: "#A3AED0", fontSize: "12px", fontWeight: "500" },
        formatter: (val: number) => formatTokens(val)
      },
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    grid: { borderColor: "#E0E5F2", strokeDashArray: 5 },
    tooltip: {
      enabled: true,
      shared: true,
      intersect: false,
      y: { formatter: (val: number) => formatTokens(val) }
    }
  };

  return <Chart options={options as never} type="area" series={series} width="100%" height="100%" />;
}
