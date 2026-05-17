"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { formatTokens } from "@/shared/format";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

type DailyRow = {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  billableTokens: number;
};

const INPUT_COLOR = "#4318FF";
const OUTPUT_COLOR = "#6AD2FF";

export function DailyUsageChart({ data }: { data: DailyRow[] }) {
  const t = useTranslations("chart");

  const series = [
    { name: t("input"), data: data.map((d) => ({ x: d.date, y: d.inputTokens })) },
    { name: t("output"), data: data.map((d) => ({ x: d.date, y: d.outputTokens })) }
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
      type: "area" as const,
      toolbar: { show: false },
      zoom: { enabled: false },
      fontFamily: "DM Sans, sans-serif",
      stacked: false
    },
    legend: { show: true, position: "top" as const, horizontalAlign: "right" as const, labels: { colors: "#A3AED0" } },
    dataLabels: { enabled: false },
    stroke: { curve: "smooth" as const, width: 3 },
    colors: [INPUT_COLOR, OUTPUT_COLOR],
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
    // Dual Y axes: Input on the left (huge values once cache reuse is included),
    // Output on the right (smaller scale). Each gets its own range so neither
    // line collapses against the other.
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
        const date = xRaw ? new Date(xRaw).toISOString().slice(0, 10) : "";
        const input = Number(s[0]?.[dataPointIndex] ?? 0);
        const output = Number(s[1]?.[dataPointIndex] ?? 0);
        return tooltipHtml(date, input, output);
      }
    }
  };

  return <Chart options={options as never} type="area" series={series} width="100%" height="100%" />;
}
