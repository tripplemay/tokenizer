"use client";

import dynamic from "next/dynamic";
import { formatTokens } from "@/shared/format";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

type DailyRow = {
  date: string;
  inputTokens: number;
  outputTokens: number;
  billableTokens: number;
};

export function DailyUsageChart({ data }: { data: DailyRow[] }) {
  const series = [
    { name: "Input", data: data.map((d) => ({ x: d.date, y: d.inputTokens })) },
    { name: "Output", data: data.map((d) => ({ x: d.date, y: d.outputTokens })) }
  ];

  const options = {
    chart: {
      type: "area" as const,
      toolbar: { show: false },
      zoom: { enabled: false },
      fontFamily: "DM Sans, sans-serif",
      stacked: true
    },
    legend: { show: true, position: "top" as const, horizontalAlign: "right" as const },
    dataLabels: { enabled: false },
    stroke: { curve: "smooth" as const, width: 2 },
    colors: ["#4318FF", "#6AD2FF"],
    fill: {
      type: "gradient",
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.4,
        opacityTo: 0,
        stops: [0, 100]
      }
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
        formatter: (val: number) => formatTokens(val)
      }
    },
    grid: { borderColor: "#E0E5F2", strokeDashArray: 5 },
    tooltip: {
      theme: "light",
      x: { format: "yyyy-MM-dd" },
      y: { formatter: (val: number) => formatTokens(val) }
    }
  };

  return <Chart options={options as never} type="area" series={series} width="100%" height="100%" />;
}
