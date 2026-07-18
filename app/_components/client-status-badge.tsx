"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { DEVICE_STATUS_COLOR, deviceStatusKey } from "@/shared/device-status";

// Recompute the badge on the client on a short timer so an idle dashboard tab
// doesn't keep showing a device as "Online" long after it went quiet. The
// status is derived from `lastSeenAt` + the *current* time, so it self-corrects
// even between full-page refreshes.
const RECOMPUTE_INTERVAL_MS = 30_000;

/**
 * `initialNowMs` is computed on the server and used for the first render so the
 * server HTML and the initial client render agree (no hydration mismatch). A
 * mount effect then switches to the viewer's own clock and keeps it fresh.
 */
export function ClientStatusBadge({
  lastSeenAt,
  initialNowMs
}: {
  lastSeenAt: string | null;
  initialNowMs: number;
}) {
  const t = useTranslations();
  const [nowMs, setNowMs] = useState(initialNowMs);

  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick(); // correct immediately on mount using the client's clock
    const id = setInterval(tick, RECOMPUTE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const key = deviceStatusKey(lastSeenAt, nowMs);
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${DEVICE_STATUS_COLOR[key]}`}>
      {t(`clientStatus.${key}`)}
    </span>
  );
}
