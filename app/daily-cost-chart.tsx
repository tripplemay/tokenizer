"use client";

import BarChart from "@/components/charts/BarChart";
import LineChart from "@/components/charts/LineChart";
import { chartTypeVisuals } from "@/shared/chart-type";
import { formatUsd } from "@/shared/format";
import { ChartTypeToggle } from "./_components/chart-type-toggle";
import { useChartType } from "./_components/use-chart-type";

type DailyCostRow = { date: string; cost: number };

const COST_COLOR = "#01B574";

export function DailyCostChart({ data }: { data: DailyCostRow[] }) {
  const [chartType, setChartType] = useChartType("daily-cost");
  const visuals = chartTypeVisuals(chartType);

  const series = [{ name: "USD", data: data.map((d) => ({ x: d.date, y: Number(d.cost.toFixed(4)) })) }];

  const options = {
    chart: {
      type: visuals.apexType,
      stacked: visuals.stacked,
      toolbar: { show: false },
      zoom: { enabled: false },
      fontFamily: "DM Sans, sans-serif"
    },
    legend: { show: false },
    dataLabels: { enabled: false },
    stroke: visuals.stroke,
    colors: [COST_COLOR],
    fill: visuals.fill,
    ...(visuals.plotOptions ? { plotOptions: visuals.plotOptions } : {}),
    xaxis: {
      type: "datetime" as const,
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
      custom: ({ series: s, dataPointIndex, w }: { series: number[][]; dataPointIndex: number; w: { globals: { seriesX: number[][] } } }) => {
        const xRaw = w.globals.seriesX?.[0]?.[dataPointIndex];
        const date = xRaw ? new Date(xRaw).toISOString().slice(0, 10) : "";
        const value = Number(s[0]?.[dataPointIndex] ?? 0);
        return `
          <div class="duc-tooltip">
            <div class="duc-tooltip-title">${date}</div>
            <div class="duc-tooltip-row">
              <span class="duc-tooltip-label">
                <span class="duc-tooltip-dot" style="background:${COST_COLOR}"></span>USD
              </span>
              <span class="duc-tooltip-value">${formatUsd(value)}</span>
            </div>
          </div>
        `;
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
