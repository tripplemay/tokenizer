import { createHash } from "node:crypto";
import { revalidateTag } from "next/cache";

export function usageCostCacheTag(userId: string): string {
  return `usage-cost:${createHash("sha256").update(userId).digest("hex")}`;
}

export function invalidateUsageCostCache(userId: string): void {
  try {
    revalidateTag(usageCostCacheTag(userId));
  } catch (error) {
    // The 30s TTL is the fallback; a committed upload must not look failed.
    console.error("Failed to invalidate usage-cost cache", error);
  }
}
