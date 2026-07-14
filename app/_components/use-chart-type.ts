"use client";

import { useCallback, useEffect, useState } from "react";
import { chartTypeStorageKey, DEFAULT_CHART_TYPE, parseChartType, type ChartType } from "@/shared/chart-type";

// Per-chart bar/line state, persisted in localStorage under a stable per-id key.
//
// The initial render always uses `fallback` (not the stored value) so server
// and first client render agree — the persisted choice is applied in an effect
// after mount, avoiding a hydration mismatch. Each chart passes a unique `id`
// so its choice is remembered independently of the others.
export function useChartType(
  id: string,
  fallback: ChartType = DEFAULT_CHART_TYPE
): [ChartType, (next: ChartType) => void] {
  const [type, setType] = useState<ChartType>(fallback);

  useEffect(() => {
    try {
      setType(parseChartType(window.localStorage.getItem(chartTypeStorageKey(id)), fallback));
    } catch {
      // localStorage unavailable (private mode, blocked) — keep the fallback.
    }
  }, [id, fallback]);

  const update = useCallback(
    (next: ChartType) => {
      setType(next);
      try {
        window.localStorage.setItem(chartTypeStorageKey(id), next);
      } catch {
        // Persisting is best-effort; ignore write failures.
      }
    },
    [id]
  );

  return [type, update];
}
