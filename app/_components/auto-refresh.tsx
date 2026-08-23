"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

// The dashboard is a fully server-rendered snapshot with no client data layer,
// so without this it never updates until the user reloads. `router.refresh()`
// re-runs the server components in place (preserving client UI state like the
// chart bar/line toggle); the server-side `unstable_cache` (revalidate: 30s)
// keeps repeated refreshes from hammering the database.
const DEFAULT_INTERVAL_MS = 30_000;

/**
 * Headless component: periodically re-fetches the current route's server
 * components. Only refreshes while the tab is visible — a backgrounded tab
 * stops polling entirely and does one catch-up refresh when it becomes visible
 * again, so we don't burn requests re-rendering a page nobody is looking at.
 */
export function AutoRefresh({ intervalMs = DEFAULT_INTERVAL_MS }: { intervalMs?: number }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const stop = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const refresh = () => {
      timer = null;
      if (document.visibilityState !== "visible" || refreshing) return;
      startTransition(() => router.refresh());
    };

    const schedule = () => {
      if (timer === null && !refreshing) timer = setTimeout(refresh, intervalMs);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh(); // catch up on whatever changed while hidden
      } else {
        stop();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    if (document.visibilityState === "visible") schedule();

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [router, intervalMs, refreshing, startTransition]);

  return null;
}
