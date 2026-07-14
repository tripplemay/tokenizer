import { describe, it, expect } from "vitest";
import {
  DEFAULT_CHART_TYPE,
  parseChartType,
  chartTypeStorageKey,
  chartTypeVisuals
} from "@/shared/chart-type";

describe("parseChartType", () => {
  it("defaults to bar", () => {
    expect(DEFAULT_CHART_TYPE).toBe("bar");
  });

  it("accepts the two valid values", () => {
    expect(parseChartType("bar")).toBe("bar");
    expect(parseChartType("line")).toBe("line");
  });

  it("falls back on null / undefined / unknown values", () => {
    expect(parseChartType(null)).toBe("bar");
    expect(parseChartType(undefined)).toBe("bar");
    expect(parseChartType("area")).toBe("bar");
    expect(parseChartType("")).toBe("bar");
  });

  it("honours an explicit fallback", () => {
    expect(parseChartType(null, "line")).toBe("line");
    expect(parseChartType("pie", "line")).toBe("line");
  });
});

describe("chartTypeStorageKey", () => {
  it("namespaces the id under a stable prefix", () => {
    expect(chartTypeStorageKey("daily-cost")).toBe("tokenizer.chartType.daily-cost");
  });
});

describe("chartTypeVisuals", () => {
  it("bar mode: columns, no stroke, solid fill, bar plotOptions", () => {
    const v = chartTypeVisuals("bar");
    expect(v.apexType).toBe("bar");
    expect(v.stroke.width).toBe(0);
    expect(v.fill.type).toBe("solid");
    expect(v.plotOptions?.bar).toBeTruthy();
  });

  it("bar mode: non-stacked by default, preserves requested stacking", () => {
    expect(chartTypeVisuals("bar").stacked).toBe(false);
    expect(chartTypeVisuals("bar", { stacked: true }).stacked).toBe(true);
  });

  it("line mode: smooth stroke, no bar plotOptions, never stacked", () => {
    const v = chartTypeVisuals("line", { stacked: true });
    expect(v.apexType).toBe("line");
    expect(v.stroke.curve).toBe("smooth");
    expect(v.stroke.width).toBeGreaterThan(0);
    expect(v.plotOptions).toBeUndefined();
    // A line chart is always drawn as independent lines, even when the
    // underlying chart (e.g. per-device cost) is stacked in bar mode.
    expect(v.stacked).toBe(false);
  });
});
