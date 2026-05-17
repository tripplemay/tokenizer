"use client";

import dynamic from "next/dynamic";
import { formatUsd } from "@/shared/format";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

type DailyCostRow = { date: string; cost: number };

const COST_COLOR = "#01B574";

export function DailyCostChart({ data }: { data: DailyCostRow[] }) {
  const series = [{ name: "USD", data: data.map((d) => ({ x: d.date, y: Number(d.cost.toFixed(4)) })) }];

  const options = {
    chart: {
      type: "area" as const,
      toolbar: { show: false },
      zoom: { enabled: false },
      fontFamily: "DM Sans, sans-serif"
    },
    legend: { show: false },
    dataLabels: { enabled: false },
    stroke: { curve: "smooth" as const, width: 3 },
    colors: [COST_COLOR],
    fill: {
      type: "gradient",
      gradient: { shadeIntensity: 1, opacityFrom: 0.3, opacityTo: 0, stops: [0, 100] }
    },
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

  return <Chart options={options as never} type="area" series={series} width="100%" height="100%" />;
}
