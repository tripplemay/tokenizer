"use client";

import BarChart from "@/components/charts/BarChart";
import LineChart from "@/components/charts/LineChart";
import { chartTypeVisuals } from "@/shared/chart-type";
import { formatUsd } from "@/shared/format";
import { ChartTypeToggle } from "../_components/chart-type-toggle";
import { useChartType } from "../_components/use-chart-type";

type SeriesItem = { name: string; data: number[] };

// Cycled palette — first 4 devices get accent colours, the rest cycle the
// neutral palette. Most users will have <5 devices so this is plenty.
const PALETTE = ["#4318FF", "#FF6F61", "#01B574", "#FFB547", "#6AD2FF", "#A3AED0", "#FF5630"];

export function DailyDeviceCostChart({ dates, series }: { dates: string[]; series: SeriesItem[] }) {
  const [chartType, setChartType] = useChartType("daily-device-cost");
  // Per-device cost composes a daily total, so bar mode stacks. Line mode draws
  // one independent line per device (a stacked line reads as ambiguous bands).
  const visuals = chartTypeVisuals(chartType, { stacked: true });

  const colors = series.map((_, i) => PALETTE[i % PALETTE.length]);
  // Pre-format dates strictly to YYYY-MM-DD so the tooltip stays consistent
  // regardless of locale.
  const safeDates = dates.map((d) => d.slice(0, 10));

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
    colors,
    fill: visuals.fill,
    ...(visuals.plotOptions ? { plotOptions: visuals.plotOptions } : {}),
    xaxis: {
      type: "category" as const,
      categories: safeDates,
      labels: { style: { colors: "#A3AED0", fontSize: "12px", fontWeight: "500" } },
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    yaxis: {
      labels: {
        style: { colors: "#A3AED0", fontSize: "12px", fontWeight: "500" },
        formatter: (val: number) => formatUsd(val)
      },
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    grid: { borderColor: "#E0E5F2", strokeDashArray: 5 },
    tooltip: {
      enabled: true,
      shared: true,
      intersect: false,
      // Custom HTML so the popup has a proper background (the default
      // ApexCharts tooltip ships transparent and reads poorly on top of
      // the stacked series).
      custom: ({ series: s, dataPointIndex }: { series: number[][]; dataPointIndex: number }) => {
        const date = safeDates[dataPointIndex] ?? "";
        const rows = series
          .map((item, i) => {
            const value = Number(s[i]?.[dataPointIndex] ?? 0);
            if (value === 0) return "";
            return `
              <div class="duc-tooltip-row">
                <span class="duc-tooltip-label">
                  <span class="duc-tooltip-dot" style="background:${colors[i]}"></span>${item.name}
                </span>
                <span class="duc-tooltip-value">${formatUsd(value)}</span>
              </div>
            `;
          })
          .join("");
        return `<div class="duc-tooltip"><div class="duc-tooltip-title">${date}</div>${rows}</div>`;
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
