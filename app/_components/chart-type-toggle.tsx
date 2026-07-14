"use client";

import { useTranslations } from "next-intl";
import { MdBarChart, MdShowChart } from "react-icons/md";
import type { ChartType } from "@/shared/chart-type";

// Segmented pill toggle for switching a chart between 柱状图 (bar) and 折线图
// (line). Mirrors the rounded-pill visual convention used by RangeSelector /
// GitFilterToggle, but is a client-state control (not a navigation link).
export function ChartTypeToggle({
  value,
  onChange,
  className
}: {
  value: ChartType;
  onChange: (next: ChartType) => void;
  className?: string;
}) {
  const t = useTranslations("chart");
  const options: Array<{ value: ChartType; label: string; Icon: typeof MdBarChart }> = [
    { value: "bar", label: t("bar"), Icon: MdBarChart },
    { value: "line", label: t("line"), Icon: MdShowChart }
  ];

  return (
    <div
      role="group"
      aria-label={t("typeToggle")}
      className={`inline-flex items-center gap-0.5 rounded-full bg-gray-100 p-1 dark:bg-navy-800 ${className ?? ""}`}
    >
      {options.map(({ value: v, label, Icon }) => {
        const active = value === v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            aria-pressed={active}
            title={label}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? "bg-white text-navy-700 shadow-sm dark:bg-navy-700 dark:text-white"
                : "text-gray-600 hover:text-navy-700 dark:text-gray-400 dark:hover:text-white"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
