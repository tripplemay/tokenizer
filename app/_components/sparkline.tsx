"use client";

import dynamic from "next/dynamic";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

// Tiny in-card trend visual: fills full width, fixed small height, no axes,
// no tooltip — purely decorative magnitude / shape signal.
export function Sparkline({
  data,
  color = "#4318FF",
  height = 44,
  fill = "gradient"
}: {
  data: number[];
  color?: string;
  height?: number;
  fill?: "gradient" | "solid";
}) {
  if (!data || data.length === 0) {
    return <div style={{ height }} className="w-full" />;
  }
  const options = {
    chart: {
      type: "area" as const,
      sparkline: { enabled: true },
      animations: { enabled: true, speed: 600 }
    },
    stroke: { curve: "smooth" as const, width: 2 },
    colors: [color],
    fill:
      fill === "gradient"
        ? { type: "gradient", gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0, stops: [0, 100] } }
        : { opacity: 0.2 },
    tooltip: { enabled: false }
  };
  return (
    <div className="w-full" style={{ height }}>
      <Chart options={options as never} series={[{ data }]} type="area" height={height} width="100%" />
    </div>
  );
}
