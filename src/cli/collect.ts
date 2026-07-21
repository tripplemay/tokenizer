import { homedir } from "node:os";
import { writeFileAtomic } from "@/cli/atomic-file";
import { parseClaudeUsage } from "@/parsers/claude";
import { parseCodexUsage } from "@/parsers/codex";
import { parseOpenCodeUsage } from "@/parsers/opencode";
import { parseAiderUsage } from "@/parsers/aider";
import { parseKimiCodeUsage } from "@/parsers/kimicode";
import { UsageEventInput } from "@/shared/usage";
import { queuePath, TokenizerConfig } from "./config";
import { ParserCursor } from "./cursor";
import { enrichEventsWithGit } from "./git";

// `cursor` is optional. When supplied, parsers will skip files whose fingerprint
// is unchanged and (for OpenCode) restrict the SQL query to rows newer than
// the cutoff. Parsers mutate the cursor in-place; the caller is responsible
// for persisting it only after a successful sync.
export function collectEvents(config: TokenizerConfig, cursor?: ParserCursor) {
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

  return { events: enrichEventsWithGit(events), warnings };
}

// Truncating write: callers are expected to pass the full deduped set they want
// persisted. The previous append-based implementation grew the queue unboundedly
// when sync repeatedly failed because each retry appended the same events again.
export function writeQueue(events: UsageEventInput[]) {
  const content = events.length ? events.map((event) => JSON.stringify(event)).join("\n") + "\n" : "";
  writeFileAtomic(queuePath, content);
}

export function dedupeBySourceEventId(events: UsageEventInput[]): UsageEventInput[] {
  const map = new Map<string, UsageEventInput>();
  for (const event of events) {
    map.set(`${event.source}:${event.sourceEventId}`, event);
  }
  return Array.from(map.values());
}
