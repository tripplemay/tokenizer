"use client";

import { useEffect } from "react";
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

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const start = () => {
      if (timer === null) {
        timer = setInterval(() => {
          if (document.visibilityState === "visible") router.refresh();
        }, intervalMs);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        router.refresh(); // catch up on whatever changed while hidden
        start();
      } else {
        stop();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    if (document.visibilityState === "visible") start();

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [router, intervalMs]);

  return null;
}
