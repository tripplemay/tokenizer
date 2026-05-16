import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { parseClaudeUsage } from "@/parsers/claude";
import { parseCodexUsage } from "@/parsers/codex";
import { parseOpenCodeUsage } from "@/parsers/opencode";
import { UsageEventInput } from "@/shared/usage";
import { queuePath, TokenizerConfig } from "./config";
import { enrichEventsWithGit } from "./git";

export function collectEvents(config: TokenizerConfig) {
  const parserConfig = { homeDir: homedir(), projectRoots: config.projectRoots };
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

  return { events: enrichEventsWithGit(events), warnings };
}

export function writeQueue(events: UsageEventInput[]) {
  mkdirSync(dirname(queuePath), { recursive: true });
  for (const event of events) appendFileSync(queuePath, `${JSON.stringify(event)}\n`);
}
