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
export type MergeQueueOptions = { timeoutMs?: number; beforeMutate?: () => void };

function queueEventIdentity(event: UsageEventInput): string {
  return `${event.source}\u0000${event.sourceEventId}`;
}

export function mergeQueue(
  events: UsageEventInput[],
  path = queuePath,
  options: MergeQueueOptions = {}
): { events: UsageEventInput[]; added: number } {
  let result: { events: UsageEventInput[]; added: number } | undefined;
  withFileLock(path, () => {
    const existing = readQueueUnlocked(path);
    const existingVersions = new Set(existing.map(queueEventVersion));
    const identityOrder: string[] = [];
    const versionsByIdentity = new Map<string, Map<string, UsageEventInput>>();
    for (const event of [...existing, ...events]) {
      const normalized = normalizeQueueEvent(event);
      const identity = queueEventIdentity(normalized);
      let versions = versionsByIdentity.get(identity);
      if (!versions) {
        versions = new Map();
        versionsByIdentity.set(identity, versions);
        identityOrder.push(identity);
      }
      versions.set(queueEventVersion(normalized), normalized);
    }
    const merged = identityOrder.flatMap((identity) => [...versionsByIdentity.get(identity)!.values()]);
    const added = new Set(events.map(queueEventVersion).filter((version) => !existingVersions.has(version))).size;
    options.beforeMutate?.();
    writeFileAtomic(path, serializeQueue(merged), SECURE_QUEUE_WRITE);
    result = { events: merged, added };
  }, { timeoutMs: options.timeoutMs });
  return result!;
}

export function mergeQueueEvents(events: UsageEventInput[]): UsageEventInput[] {
  return mergeQueue(events).events;
}

// Historical callers use writeQueue as a void callback. Keep that contract so
// old tests and extensions cannot accidentally depend on a return value.
export function writeQueue(events: UsageEventInput[]): void {
  mergeQueueEvents(events);
}

export function acknowledgeQueuedEvents(events: UsageEventInput[], path = queuePath): UsageEventInput[] {
  return withFileLock(path, () => {
    const resolved = new Set(events.map(queueEventVersion));
    const remaining = readQueueUnlocked(path).filter((event) => !resolved.has(queueEventVersion(event)));
    writeFileAtomic(path, serializeQueue(remaining), SECURE_QUEUE_WRITE);
    return remaining;
  });
}

export function resolveQueueEvents(resolution: {
  accepted: UsageEventInput[];
  rejected: Array<{ event: UsageEventInput; code: string }>;
}): UsageEventInput[] {
  return withFileLock(queuePath, () => {
    const current = readQueueUnlocked(queuePath);
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
