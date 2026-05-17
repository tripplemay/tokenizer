"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { formatTokens } from "@/shared/format";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

type DailyRow = {
  date: string;
  inputTokens: number;
  outputTokens: number;
  billableTokens: number;
};

export function DailyUsageChart({ data }: { data: DailyRow[] }) {
  const t = useTranslations("chart");

  const series = [
    { name: t("input"), data: data.map((d) => ({ x: d.date, y: d.inputTokens })) },
    { name: t("output"), data: data.map((d) => ({ x: d.date, y: d.outputTokens })) }
  ];

  function tooltipHtml(date: string, input: number, output: number): string {
    const total = input + output;
    return `
      <div class="duc-tooltip">
        <div class="duc-tooltip-title">${date}</div>
        <div class="duc-tooltip-row">
          <span class="duc-tooltip-label">
            <span class="duc-tooltip-dot" style="background:#4318FF"></span>${t("input")}
          </span>
          <span class="duc-tooltip-value">${formatTokens(input)}</span>
        </div>
        <div class="duc-tooltip-row">
          <span class="duc-tooltip-label">
            <span class="duc-tooltip-dot" style="background:#6AD2FF"></span>${t("output")}
          </span>
          <span class="duc-tooltip-value">${formatTokens(output)}</span>
        </div>
        <div class="duc-tooltip-row duc-tooltip-total">
          <span class="duc-tooltip-label">${t("total")}</span>
          <span class="duc-tooltip-value">${formatTokens(total)}</span>
        </div>
      </div>
    `;
  }

  const options = {
    chart: {
      type: "area" as const,
      toolbar: { show: false },
      zoom: { enabled: false },
      fontFamily: "DM Sans, sans-serif",
      stacked: false
    },
    legend: { show: true, position: "top" as const, horizontalAlign: "right" as const, labels: { colors: "#A3AED0" } },
    dataLabels: { enabled: false },
    stroke: { curve: "smooth" as const, width: 3 },
    colors: ["#4318FF", "#6AD2FF"],
    fill: {
      type: "gradient",
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.25,
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
      enabled: true,
      shared: true,
      intersect: false,
      custom: ({ series: s, dataPointIndex, w }: { series: number[][]; dataPointIndex: number; w: { globals: { seriesX: number[][] } } }) => {
        const xRaw = w.globals.seriesX?.[0]?.[dataPointIndex];
        const date = xRaw ? new Date(xRaw).toISOString().slice(0, 10) : "";
        const input = Number(s[0]?.[dataPointIndex] ?? 0);
        const output = Number(s[1]?.[dataPointIndex] ?? 0);
        return tooltipHtml(date, input, output);
      }
    }
  };

  return <Chart options={options as never} type="area" series={series} width="100%" height="100%" />;
}
