import { sanitizeUsageEventGit } from "@/shared/git-remote";
import type { UsageEventInput } from "@/shared/usage";
import { minimizeUsageEvent } from "@/shared/usage-privacy";

export function normalizeQueueEvent(event: UsageEventInput): UsageEventInput {
  return minimizeUsageEvent(sanitizeUsageEventGit(event));
}

export function queueEventVersion(event: UsageEventInput): string {
  return JSON.stringify(normalizeQueueEvent(event));
}
