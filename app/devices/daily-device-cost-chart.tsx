"use client";

import dynamic from "next/dynamic";
import { formatUsd } from "@/shared/format";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

type SeriesItem = { name: string; data: number[] };

// Cycled palette — first 4 devices get accent colours, the rest cycle the
// neutral palette. Most users will have <5 devices so this is plenty.
const PALETTE = ["#4318FF", "#FF6F61", "#01B574", "#FFB547", "#6AD2FF", "#A3AED0", "#FF5630"];

export function DailyDeviceCostChart({ dates, series }: { dates: string[]; series: SeriesItem[] }) {
  const colors = series.map((_, i) => PALETTE[i % PALETTE.length]);

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
      y: { formatter: (val: number) => formatUsd(val) }
    }
  };

  return <Chart options={options as never} type="area" series={series} width="100%" height="100%" />;
}
