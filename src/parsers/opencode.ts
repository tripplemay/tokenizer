import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ParserConfig, ParserResult } from "./types";

export function parseOpenCodeUsage(_config: ParserConfig): ParserResult {
  return { events: [], warnings: ["OpenCode parser is not implemented yet. Run tokenizer diagnose opencode to locate logs."] };
}

export function diagnoseOpenCode(homeDir: string, cwd: string): string[] {
  const candidates = [
    join(homeDir, ".opencode"),
    join(homeDir, ".config", "opencode"),
    join(homeDir, "Library", "Application Support", "opencode"),
    join(cwd, ".opencode")
  ];
  const found: string[] = [];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    found.push(candidate);
    for (const name of readdirSync(candidate)) {
      const full = join(candidate, name);
      const stat = statSync(full);
      if (stat.isFile() && /usage|session|log|jsonl|json/i.test(name)) found.push(`  ${full}`);
    }
  }
  return found;
}
