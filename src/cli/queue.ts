import { existsSync, readFileSync } from "node:fs";
import { withFileLock, writeFileAtomic } from "@/cli/atomic-file";
import type { UsageEventInput } from "@/shared/usage";
import { queuePath } from "./config";
import { normalizeQueueEvent, queueEventVersion } from "./queue-event-version";
import { quarantineUsageEvents } from "./rejected-events";

export { queueEventVersion } from "./queue-event-version";

const SECURE_QUEUE_WRITE = { mode: 0o600, directoryMode: 0o700, restrictToOwner: true } as const;

function parseQueue(text: string): UsageEventInput[] {
  return text.split(/\r?\n/).filter(Boolean)
    .map((line) => normalizeQueueEvent(JSON.parse(line) as UsageEventInput));
}

function serializeQueue(events: UsageEventInput[]): string {
  return events.length ? events.map((event) => JSON.stringify(normalizeQueueEvent(event))).join("\n") + "\n" : "";
}

function readQueueUnlocked(path: string): UsageEventInput[] {
  return existsSync(path) ? parseQueue(readFileSync(path, "utf8")) : [];
}

export function readQueue(path = queuePath): UsageEventInput[] {
  return withFileLock(path, () => {
    const events = readQueueUnlocked(path);
    const minimized = serializeQueue(events);
    if (existsSync(path) && minimized !== readFileSync(path, "utf8")) {
      writeFileAtomic(path, minimized, SECURE_QUEUE_WRITE);
    }
    return events;
  });
}

// Merge exact event versions under the queue lock. Different versions of the
// same source ID intentionally coexist until the server ACKs each version: an
// ACK for an in-flight old parse must never delete a concurrently collected
// correction for that ID.
export function mergeQueue(
  events: UsageEventInput[],
  path = queuePath,
  options: { timeoutMs?: number; beforeMutate?: () => void } = {}
): { events: UsageEventInput[]; added: number } {
  return withFileLock(path, () => {
    const byVersion = new Map<string, UsageEventInput>();
    for (const event of readQueueUnlocked(path)) {
      byVersion.set(queueEventVersion(event), event);
    }
    const previousCount = byVersion.size;
    for (const event of events) {
      const normalized = normalizeQueueEvent(event);
      byVersion.set(queueEventVersion(normalized), normalized);
    }
    // Keep each identity's first-seen position for existing callers without
    // collapsing its independently acknowledged correction versions.
    const byIdentity = new Map<string, UsageEventInput[]>();
    for (const event of byVersion.values()) {
      const identity = JSON.stringify([event.source, event.sourceEventId]);
      const versions = byIdentity.get(identity) ?? [];
      versions.push(event);
      byIdentity.set(identity, versions);
    }
    const merged = [...byIdentity.values()].flat();
    const content = serializeQueue(merged);
    options.beforeMutate?.();
    writeFileAtomic(path, content, SECURE_QUEUE_WRITE);
    return { events: merged, added: byVersion.size - previousCount };
  }, { timeoutMs: options.timeoutMs });
}

export function mergeQueueEvents(events: UsageEventInput[]): UsageEventInput[] {
  return mergeQueue(events).events;
}

// Historical callers use writeQueue as a void callback. Keep that contract so
// old tests and extensions cannot accidentally depend on a return value.
export function writeQueue(events: UsageEventInput[]): void {
  mergeQueueEvents(events);
}

export function resolveQueueEvents(resolution: {
  accepted: UsageEventInput[];
  rejected: Array<{ event: UsageEventInput; code: string }>;
}, path = queuePath): UsageEventInput[] {
  return withFileLock(path, () => {
    const current = readQueueUnlocked(path);
    // Quarantine first. If this or the following atomic queue write fails, the
    // old active queue remains available for an idempotent retry.
    if (resolution.rejected.length > 0) quarantineUsageEvents(resolution.rejected);
    const resolved = new Set([
      ...resolution.accepted.map(queueEventVersion),
      ...resolution.rejected.map((item) => queueEventVersion(item.event))
    ]);
    const remaining = current.filter((event) => !resolved.has(queueEventVersion(event)));
    writeFileAtomic(path, serializeQueue(remaining), SECURE_QUEUE_WRITE);
    return remaining;
  });
}

// Compatibility for existing Agent callbacks and explicitly scoped replay tests.
// Resolution is idempotent even when sync has already committed the same ACK.
export function acknowledgeQueuedEvents(events: UsageEventInput[], path = queuePath): UsageEventInput[] {
  return resolveQueueEvents({ accepted: events, rejected: [] }, path);
}
