// Single source of truth for device online-status classification.
//
// The caller passes `nowMs` explicitly instead of the logic reading Date.now()
// itself. That keeps the classification pure (and unit-testable), and — more
// importantly — lets a client component recompute the badge on a timer so the
// status doesn't stay frozen at the value it had when the page was rendered.

export const DEVICE_ONLINE_MS = 20 * 60 * 1000;
export const DEVICE_STALE_MS = 60 * 60 * 1000;

export type DeviceStatusKey = "online" | "stale" | "offline" | "neverSeen";

export const DEVICE_STATUS_COLOR: Record<DeviceStatusKey, string> = {
  online: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300",
  stale: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300",
  offline: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300",
  neverSeen: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300"
};

/**
 * Classify a device by how long ago it was last seen.
 *
 * Thresholds match the default 15-minute cron sync cadence so cron-mode clients
 * aren't flagged Stale immediately: "missed 0 cycles" = Online (< 20 min),
 * "missed up to ~3 cycles" = Stale (< 60 min), beyond that = Offline.
 */
export function deviceStatusKey(lastSeenAt: string | null | undefined, nowMs: number): DeviceStatusKey {
  if (!lastSeenAt) return "neverSeen";
  const ageMs = nowMs - new Date(lastSeenAt).getTime();
  if (ageMs < DEVICE_ONLINE_MS) return "online";
  if (ageMs < DEVICE_STALE_MS) return "stale";
  return "offline";
}

/** Status key paired with its badge color class. */
export function deviceStatusBadge(
  lastSeenAt: string | null | undefined,
  nowMs: number
): { key: DeviceStatusKey; color: string } {
  const key = deviceStatusKey(lastSeenAt, nowMs);
  return { key, color: DEVICE_STATUS_COLOR[key] };
}
