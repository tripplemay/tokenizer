"use client";

import { useEffect } from "react";

// Reports the browser's IANA timezone to the server once per mount.
// Fire-and-forget: failures aren't surfaced because losing this update
// isn't worth bothering the user — the next dashboard load (or CLI
// sync) will try again. Returns null because it has no visual output.
export function TimezoneReporter() {
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return;
    fetch("/api/me/timezone", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timezone: tz }),
      credentials: "same-origin",
    }).catch(() => {});
  }, []);
  return null;
}
