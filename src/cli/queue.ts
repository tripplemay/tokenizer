import { existsSync, readFileSync } from "node:fs";
import { withFileLock, writeFileAtomic } from "@/cli/atomic-file";
import type { UsageEventInput } from "@/shared/usage";
import { minimizeUsageEvent } from "@/shared/usage-privacy";
import { sanitizeUsageEventGit } from "@/shared/git-remote";
import { queuePath } from "./config";
import { quarantineUsageEvents } from "./rejected-events";

const SECURE_QUEUE_WRITE = { mode: 0o600, directoryMode: 0o700, restrictToOwner: true } as const;

function normalizeQueueEvent(event: UsageEventInput): UsageEventInput {
  return minimizeUsageEvent(sanitizeUsageEventGit(event));
}

function parseQueue(text: string): UsageEventInput[] {
  return text.split(/\r?\n/).filter(Boolean)
    .map((line) => normalizeQueueEvent(JSON.parse(line) as UsageEventInput));
}

function serializeQueue(events: UsageEventInput[]): string {
  return events.length ? events.map((event) => JSON.stringify(normalizeQueueEvent(event))).join("\n") + "\n" : "";
}

export function queueEventVersion(event: UsageEventInput): string {
  return JSON.stringify(normalizeQueueEvent(event));
}

function readQueueUnlocked(): UsageEventInput[] {
  return existsSync(queuePath) ? parseQueue(readFileSync(queuePath, "utf8")) : [];
}

export function readQueue(): UsageEventInput[] {
  return withFileLock(queuePath, () => {
    const events = readQueueUnlocked();
    const minimized = serializeQueue(events);
    if (existsSync(queuePath) && minimized !== readFileSync(queuePath, "utf8")) {
      writeFileAtomic(queuePath, minimized, SECURE_QUEUE_WRITE);
    }
    return events;
  });
}

// Merge exact event versions under the queue lock. Different versions of the
// same source ID intentionally coexist until the server ACKs each version: an
// ACK for an in-flight old parse must never delete a concurrently collected
// correction for that ID.
export function mergeQueueEvents(events: UsageEventInput[]): UsageEventInput[] {
  return withFileLock(queuePath, () => {
    const byVersion = new Map<string, UsageEventInput>();
    for (const event of [...readQueueUnlocked(), ...events]) {
      const normalized = normalizeQueueEvent(event);
      byVersion.set(queueEventVersion(normalized), normalized);
    }
    const merged = [...byVersion.values()];
    writeFileAtomic(queuePath, serializeQueue(merged), SECURE_QUEUE_WRITE);
    return merged;
  });
}

// Historical callers use writeQueue as a void callback. Keep that contract so
// old tests and extensions cannot accidentally depend on a return value.
export function writeQueue(events: UsageEventInput[]): void {
  mergeQueueEvents(events);
}

export function resolveQueueEvents(resolution: {
  accepted: UsageEventInput[];
  rejected: Array<{ event: UsageEventInput; code: string }>;
}): UsageEventInput[] {
  return withFileLock(queuePath, () => {
    const current = readQueueUnlocked();
    // Quarantine first. If this or the following atomic queue write fails, the
    // old active queue remains available for an idempotent retry.
    if (resolution.rejected.length > 0) quarantineUsageEvents(resolution.rejected);
    const resolved = new Set([
      ...resolution.accepted.map(queueEventVersion),
      ...resolution.rejected.map((item) => queueEventVersion(item.event))
    ]);
    const remaining = current.filter((event) => !resolved.has(queueEventVersion(event)));
    writeFileAtomic(queuePath, serializeQueue(remaining), SECURE_QUEUE_WRITE);
    return remaining;
  });
}
