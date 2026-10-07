import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { withFileLock, writeFileAtomic } from "@/cli/atomic-file";
import { parseClaudeUsage } from "@/parsers/claude";
import { parseCodexUsage } from "@/parsers/codex";
import { parseOpenCodeUsage } from "@/parsers/opencode";
import { parseAiderUsage } from "@/parsers/aider";
import { parseKimiCodeUsage } from "@/parsers/kimicode";
import { UsageEventInput } from "@/shared/usage";
import { minimizeUsageEvent } from "@/shared/usage-privacy";
import { sanitizeUsageEventGit } from "@/shared/git-remote";
import { queuePath, TokenizerConfig } from "./config";
import { ParserCursor } from "./cursor";
import { enrichEventsWithGit } from "./git";
import { effectivePrivacy, filterUsageEvents } from "./privacy";

// `cursor` is optional. When supplied, parsers will skip files whose fingerprint
// is unchanged and (for OpenCode) restrict the SQL query to rows newer than
// the cutoff. Parsers mutate the cursor in-place; the caller persists it only
// after the collected events are safely present in the durable upload queue.
export function collectEvents(config: TokenizerConfig, cursor?: ParserCursor) {
  const privacy = effectivePrivacy(config);
  if (privacy.mode === "paused") return { events: [] as UsageEventInput[], warnings: [] as string[] };
  const parserConfig = { homeDir: homedir(), projectRoots: config.projectRoots, cursor };
  const warnings: string[] = [];
  const events: UsageEventInput[] = [];

  if (config.sources.claude) {
    const result = parseClaudeUsage(parserConfig);
    events.push(...result.events);
    warnings.push(...result.warnings);
  }
  if (config.sources.codex) {
    const result = parseCodexUsage(parserConfig);
    events.push(...result.events);
    warnings.push(...result.warnings);
  }
  if (config.sources.opencode) {
    const result = parseOpenCodeUsage(parserConfig);
    events.push(...result.events);
    warnings.push(...result.warnings);
  }
  if (config.sources.aider) {
    const result = parseAiderUsage(parserConfig);
    events.push(...result.events);
    warnings.push(...result.warnings);
  }
  if (config.sources.kimicode) {
    const result = parseKimiCodeUsage(parserConfig);
    events.push(...result.events);
    warnings.push(...result.warnings);
  }

  return { events: filterUsageEvents(enrichEventsWithGit(filterUsageEvents(events, privacy)), privacy).map(minimizeUsageEvent), warnings };
}

// Truncating write: callers are expected to pass the full deduped set they want
// persisted. The previous append-based implementation grew the queue unboundedly
// when sync repeatedly failed because each retry appended the same events again.
export function writeQueue(events: UsageEventInput[]) {
  const content = events.length ? events.map((event) => JSON.stringify(minimizeUsageEvent(sanitizeUsageEventGit(event)))).join("\n") + "\n" : "";
  withFileLock(queuePath, () => writeFileAtomic(queuePath, content));
}

export function mergeQueue(events: UsageEventInput[], path = queuePath): { events: UsageEventInput[]; added: number } {
  const incoming = events.map((event) => minimizeUsageEvent(sanitizeUsageEventGit(event)));
  let result: { events: UsageEventInput[]; added: number } | undefined;
  withFileLock(path, () => {
    const existing = existsSync(path)
      ? readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)
        .map((line) => minimizeUsageEvent(sanitizeUsageEventGit(JSON.parse(line) as UsageEventInput)))
      : [];
    const existingKeys = new Set(existing.map((event) => `${event.source}:${event.sourceEventId}`));
    const merged = dedupeBySourceEventId([...existing, ...incoming]);
    const added = new Set(incoming
      .map((event) => `${event.source}:${event.sourceEventId}`)
      .filter((key) => !existingKeys.has(key))).size;
    const content = merged.length ? merged.map((event) => JSON.stringify(event)).join("\n") + "\n" : "";
    writeFileAtomic(path, content);
    result = { events: merged, added };
  });
  return result!;
}

// Remove only the exact event versions acknowledged by the server. Writers
// may merge replay or fresh collection events while a network request is in
// flight; rewriting a previously computed tail would erase those additions.
// A concurrently corrected event with the same ID is retained for re-upload.
export function acknowledgeQueuedEvents(events: UsageEventInput[], path = queuePath): UsageEventInput[] {
  const acknowledged = new Map(events.map((event) => {
    const minimized = minimizeUsageEvent(sanitizeUsageEventGit(event));
    return [`${minimized.source}:${minimized.sourceEventId}`, JSON.stringify(minimized)];
  }));
  let remaining: UsageEventInput[] = [];
  withFileLock(path, () => {
    const current = existsSync(path)
      ? readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)
        .map((line) => minimizeUsageEvent(sanitizeUsageEventGit(JSON.parse(line) as UsageEventInput)))
      : [];
    remaining = current.filter((event) => {
      const expected = acknowledged.get(`${event.source}:${event.sourceEventId}`);
      return expected === undefined || expected !== JSON.stringify(event);
    });
    const content = remaining.length ? remaining.map((event) => JSON.stringify(event)).join("\n") + "\n" : "";
    writeFileAtomic(path, content);
  });
  return remaining;
}

export function dedupeBySourceEventId(events: UsageEventInput[]): UsageEventInput[] {
  const map = new Map<string, UsageEventInput>();
  for (const event of events) {
    map.set(`${event.source}:${event.sourceEventId}`, event);
  }
  return Array.from(map.values());
}
