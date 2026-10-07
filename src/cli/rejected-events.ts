import { existsSync, readFileSync } from "node:fs";
import { withFileLock, writeFileAtomic } from "@/cli/atomic-file";
import { sanitizeUsageEventGit } from "@/shared/git-remote";
import type { UsageEventInput } from "@/shared/usage";
import { minimizeUsageEvent } from "@/shared/usage-privacy";
import { rejectedUsagePath } from "./config";

export type RejectedUsageEvent = {
  version: 1;
  rejectedAt: string;
  code: string;
  event: UsageEventInput;
};

function parseRejected(text: string): RejectedUsageEvent[] {
  return text.split(/\r?\n/).filter(Boolean).map((line) => {
    const row = JSON.parse(line) as Partial<RejectedUsageEvent>;
    if (row.version !== 1 || typeof row.rejectedAt !== "string" ||
        typeof row.code !== "string" || !row.event || typeof row.event !== "object") {
      throw new Error("Invalid rejected usage event file");
    }
    return row as RejectedUsageEvent;
  });
}

export function readRejectedUsageEvents(path = rejectedUsagePath): RejectedUsageEvent[] {
  if (!existsSync(path)) return [];
  return parseRejected(readFileSync(path, "utf8"));
}

export function quarantineUsageEvents(
  rejected: Array<{ event: UsageEventInput; code: string }>,
  path = rejectedUsagePath
): void {
  if (rejected.length === 0) return;
  withFileLock(path, () => {
    // A corrupt quarantine must never be overwritten: retaining the active
    // queue is safer than losing either the old rejects or the new ones.
    const existing = existsSync(path) ? parseRejected(readFileSync(path, "utf8")) : [];
    const byIdentity = new Map(
      existing.map((row) => [`${row.event.source}\u0000${row.event.sourceEventId}`, row])
    );
    for (const item of rejected) {
      const event = minimizeUsageEvent(sanitizeUsageEventGit(item.event));
      const key = `${event.source}\u0000${event.sourceEventId}`;
      if (!byIdentity.has(key)) {
        byIdentity.set(key, {
          version: 1,
          rejectedAt: new Date().toISOString(),
          code: item.code,
          event
        });
      }
    }
    writeFileAtomic(
      path,
      [...byIdentity.values()].map((row) => JSON.stringify(row)).join("\n") + "\n",
      { mode: 0o600, directoryMode: 0o700, restrictToOwner: true }
    );
  });
}
