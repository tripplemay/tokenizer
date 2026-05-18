import { cache } from "react";
import { prisma } from "./db";

const DEFAULT_TIMEZONE = "Asia/Shanghai";
const MAX_TZ_LENGTH = 64;

export function isValidIanaTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > MAX_TZ_LENGTH) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(userTz: string | null | undefined): string {
  return userTz && userTz.length > 0 ? userTz : DEFAULT_TIMEZONE;
}

// React 19 cache() — dedups within a single render so multiple
// aggregation calls in one page don't each re-query User.timezone.
// NOT wrapped in unstable_cache: we want a fresh read on every page
// request so a recent tz update (from CLI sync or browser PATCH) is
// reflected immediately.
export const getUserTimezone = cache(async (userId: string): Promise<string> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  return resolveTimezone(user?.timezone);
});

// Best-effort update — silently ignores invalid tz. Sync and heartbeat
// endpoints call this; we never want a bad tz string to fail the whole
// ingest. The /api/me/timezone PATCH endpoint validates BEFORE this
// and returns 400 to the browser when invalid.
export async function updateUserTimezoneIfValid(userId: string, tz: unknown): Promise<void> {
  if (!isValidIanaTimezone(tz)) return;
  await prisma.user.update({
    where: { id: userId },
    data: { timezone: tz },
  });
}
