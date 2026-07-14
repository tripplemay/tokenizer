// Shared, framework-free logic for the "柱状图 / 折线图" (bar / line) chart-type
// toggle. Kept pure so it can be unit-tested in the repo's node test env
// (the React hook/toggle/chart components live under app/_components and are
// verified via tsc + running the app).

export type ChartType = "bar" | "line";

export const CHART_TYPES: readonly ChartType[] = ["bar", "line"];

// Default to bar: discrete per-day/-hour buckets read most clearly as columns.
export const DEFAULT_CHART_TYPE: ChartType = "bar";

const STORAGE_PREFIX = "tokenizer.chartType.";

// Per-chart localStorage key. Each chart persists its own choice independently.
export function chartTypeStorageKey(id: string): string {
  return `${STORAGE_PREFIX}${id}`;
}

// Validate an untrusted value (e.g. from localStorage) into a ChartType,
// falling back when it is null/absent or not one of the known types.
export function parseChartType(
  raw: string | null | undefined,
  fallback: ChartType = DEFAULT_CHART_TYPE
): ChartType {
  return raw === "bar" || raw === "line" ? raw : fallback;
}

export interface ChartTypeVisuals {
  apexType: ChartType;
  stroke: { curve: "smooth"; width: number; show: boolean };
  fill: { type: "solid"; opacity: number };
  plotOptions?: {
    bar: { borderRadius: number; columnWidth: string; borderRadiusApplication: "end" };
  };
  stacked: boolean;
}

// The ApexCharts option fragments that differ by chart type. Callers merge
// these into their own bespoke options (axes, colours, tooltip, dual-axis)
// and pass the result to the template BarChart/LineChart wrappers.
//
// `stacked` is the chart's *desired* stacking (e.g. per-device cost is stacked).
// It only applies to bar mode; a line chart is always drawn as independent
// lines, since a stacked line reads as ambiguous cumulative bands.
export function chartTypeVisuals(
  type: ChartType,
  opts: { stacked?: boolean } = {}
): ChartTypeVisuals {
  const wantStacked = opts.stacked ?? false;

  if (type === "bar") {
    return {
      apexType: "bar",
      // No border stroke on columns — a stroke reads as an unwanted outline.
      stroke: { curve: "smooth", width: 0, show: false },
      fill: { type: "solid", opacity: 0.95 },
      plotOptions: {
        // borderRadiusApplication "end" rounds only the outer edge, which
        // keeps stacked segments flush against each other.
        bar: { borderRadius: 4, columnWidth: "60%", borderRadiusApplication: "end" }
      },
      stacked: wantStacked
    };
  }

  return {
    apexType: "line",
    stroke: { curve: "smooth", width: 3, show: true },
    // Line charts have no area fill; opacity is inert for line type but kept
    // explicit so it deterministically overrides any inherited gradient.
    fill: { type: "solid", opacity: 1 },
    stacked: false
  };
}
