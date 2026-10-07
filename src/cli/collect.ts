import { homedir } from "node:os";
import { parseClaudeUsage } from "@/parsers/claude";
import { parseCodexUsage } from "@/parsers/codex";
import { parseOpenCodeUsage } from "@/parsers/opencode";
import { parseAiderUsage } from "@/parsers/aider";
import { parseKimiCodeUsage } from "@/parsers/kimicode";
import { UsageEventInput } from "@/shared/usage";
import { minimizeUsageEvent } from "@/shared/usage-privacy";
import { TokenizerConfig } from "./config";
import { ParserCursor } from "./cursor";
import { enrichEventsWithGit } from "./git";
import { effectivePrivacy, filterUsageEvents } from "./privacy";
export { acknowledgeQueuedEvents, mergeQueue, mergeQueueEvents, queueEventVersion, readQueue, resolveQueueEvents, writeQueue } from "./queue";

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

export function dedupeBySourceEventId(events: UsageEventInput[]): UsageEventInput[] {
  const map = new Map<string, UsageEventInput>();
  for (const event of events) {
    map.set(`${event.source}:${event.sourceEventId}`, event);
  }
  return Array.from(map.values());
}
