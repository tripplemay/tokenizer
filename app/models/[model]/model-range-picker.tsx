"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";

// Wall-clock "YYYY-MM-DDTHH:MM" for an instant in `tz`. Presets compute against
// the user's *configured* tz (passed from the server), not the browser's, so
// "today" matches what the rest of the dashboard considers today.
function wallClockInTz(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const m: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") m[p.type] = p.value;
  const hour = m.hour === "24" ? "00" : m.hour;
  return `${m.year}-${m.month}-${m.day}T${hour}:${m.minute}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function ModelRangePicker({
  model,
  from,
  to,
  tz,
}: {
  model: string;
  from: string;
  to: string;
  tz: string;
}) {
  const router = useRouter();
  const t = useTranslations("modelDetail.range");
  const [localFrom, setLocalFrom] = useState(from);
  const [localTo, setLocalTo] = useState(to);

  const navigate = (f: string, tt: string) => {
    const params = new URLSearchParams({ from: f, to: tt });
    router.push(`/models/${encodeURIComponent(model)}?${params.toString()}`);
  };

  const preset = (kind: "today" | "yesterday" | "last24h") => {
    const now = new Date();
    if (kind === "last24h") {
      navigate(wallClockInTz(new Date(now.getTime() - DAY_MS), tz), wallClockInTz(now, tz));
      return;
    }
    const todayDate = wallClockInTz(now, tz).slice(0, 10);
    if (kind === "today") {
      navigate(`${todayDate}T00:00`, wallClockInTz(now, tz));
      return;
    }
    // yesterday: previous local day 00:00 -> today 00:00
    const yesterdayDate = wallClockInTz(new Date(now.getTime() - DAY_MS), tz).slice(0, 10);
    navigate(`${yesterdayDate}T00:00`, `${todayDate}T00:00`);
  };

  const presetBtn = "rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200 hover:text-navy-700 dark:bg-navy-800 dark:text-gray-300 dark:hover:bg-navy-700 dark:hover:text-white";
  const inputCls = "rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-navy-700 dark:border-white/10 dark:bg-navy-900 dark:text-white";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5 text-[10px] font-medium text-gray-500">
          {t("from")}
          <input
            type="datetime-local"
            step={3600}
            value={localFrom}
            onChange={(e) => setLocalFrom(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-0.5 text-[10px] font-medium text-gray-500">
          {t("to")}
          <input
            type="datetime-local"
            step={3600}
            value={localTo}
            onChange={(e) => setLocalTo(e.target.value)}
            className={inputCls}
          />
        </label>
        <button
          type="button"
          onClick={() => navigate(localFrom, localTo)}
          className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-600"
        >
          {t("apply")}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => preset("today")} className={presetBtn}>{t("today")}</button>
        <button type="button" onClick={() => preset("yesterday")} className={presetBtn}>{t("yesterday")}</button>
        <button type="button" onClick={() => preset("last24h")} className={presetBtn}>{t("last24h")}</button>
      </div>
    </div>
  );
}
