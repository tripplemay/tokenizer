import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { UsageEventInput } from "@/shared/usage";
import { findWorkspaceFromPath, inferProjectName } from "@/cli/project";
import { recordFile, shouldSkipFile } from "@/cli/cursor";
import { ParserConfig, ParserResult } from "./types";

// Aider writes a project-local chat history file at <project>/.aider.chat.history.md.
// Each model turn appends a line of the form:
//   "Tokens: 1,234 sent, 56 cache hit, 89 received. Cost: $0.0123 message, $0.0123 session."
// We parse those lines into one usage event per turn. Sessions are delimited
// by "# aider chat started at <ISO timestamp>" headers and the active model
// is captured from nearby "Model: ..." lines so each event can be attributed
// to the right model.

const SESSION_START_RE = /^#\s*aider chat started at\s+(.+)$/i;
const MODEL_RE = /^#*\s*(?:Using model|Main model|Model)\s*:\s*([\w\-.@/:]+)/i;
const TOKEN_LINE_PROBE = /^Tokens:\s+/i;
const SENT_RE = /([\d.,]+)([kKmM]?)\s+sent/i;
const RECEIVED_RE = /([\d.,]+)([kKmM]?)\s+received/i;
const CACHE_HIT_RE = /([\d.,]+)([kKmM]?)\s+cache\s+hit/i;
const CACHE_WRITE_RE = /([\d.,]+)([kKmM]?)\s+cache\s+write/i;
const COST_RE = /Cost:\s*\$([\d.]+)\s+message/i;

function parseTokenNumber(match: RegExpExecArray | null): number {
  if (!match) return 0;
  let value = parseFloat(match[1].replace(/,/g, ""));
  if (!Number.isFinite(value)) return 0;
  const suffix = (match[2] ?? "").toLowerCase();
  if (suffix === "k") value *= 1_000;
  if (suffix === "m") value *= 1_000_000;
  return Math.round(value);
}

type ParsedTokens = {
  sent: number;
  received: number;
  cacheHit: number;
  cacheWrite: number;
  cost: number | null;
};

export function parseAiderTokensLine(line: string): ParsedTokens | null {
  if (!TOKEN_LINE_PROBE.test(line)) return null;
  const sent = SENT_RE.exec(line);
  const received = RECEIVED_RE.exec(line);
  if (!sent || !received) return null;
  return {
    sent: parseTokenNumber(sent),
    received: parseTokenNumber(received),
    cacheHit: parseTokenNumber(CACHE_HIT_RE.exec(line)),
    cacheWrite: parseTokenNumber(CACHE_WRITE_RE.exec(line)),
    cost: (() => {
      const m = COST_RE.exec(line);
      if (!m) return null;
      const v = parseFloat(m[1]);
      return Number.isFinite(v) ? v : null;
    })()
  };
}

function walkForHistoryFiles(root: string, files: string[] = [], depth = 0): string[] {
  if (depth > 6) return files; // cap recursion — Aider history lives near project root
  let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.name === ".aider.chat.history.md" && entry.isFile()) {
      files.push(join(root, entry.name));
      continue;
    }
    // Skip noisy / known-irrelevant dirs to keep the walk cheap on big trees.
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name.startsWith(".") && entry.name !== "." && entry.name !== "..") continue;
      walkForHistoryFiles(join(root, entry.name), files, depth + 1);
    }
  }
  return files;
}

function parseHistoryFile(file: string, config: ParserConfig, events: UsageEventInput[], warnings: string[]) {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    warnings.push(`Failed to read Aider history ${file}: ${(error as Error).message}`);
    return;
  }
  const lines = text.split(/\r?\n/);
  const workspacePath = findWorkspaceFromPath(file, config.projectRoots) ?? null;
  let sessionTimestamp: string | null = null;
  let currentModel: string | null = null;
  const fileMtime = (() => {
    try { return statSync(file).mtime.toISOString(); } catch { return new Date().toISOString(); }
  })();

  lines.forEach((line, index) => {
    const sessionMatch = SESSION_START_RE.exec(line);
    if (sessionMatch) {
      const parsed = new Date(sessionMatch[1].trim());
      sessionTimestamp = Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
      return;
    }
    const modelMatch = MODEL_RE.exec(line);
    if (modelMatch) {
      currentModel = modelMatch[1].trim();
      return;
    }
    const tokens = parseAiderTokensLine(line);
    if (!tokens) return;
    // Aider's "sent" count already includes cache hits / writes when they are
    // present on the same line. Treat the sum as our canonical inputTokens so
    // the dashboard's compute = max(0, input - cached) + output formula stays
    // consistent across sources.
    const inputTokens = Math.max(tokens.sent, tokens.cacheHit + tokens.cacheWrite + Math.max(0, tokens.sent - tokens.cacheHit - tokens.cacheWrite));
    events.push({
      source: "aider",
      sourceEventId: `aider:${file}:${index + 1}`,
      projectName: inferProjectName(workspacePath),
      workspacePath,
      model: currentModel,
      inputTokens,
      outputTokens: tokens.received,
      cachedInputTokens: tokens.cacheHit,
      cacheWriteTokens: tokens.cacheWrite,
      totalTokens: inputTokens + tokens.received,
      costUsd: tokens.cost,
      occurredAt: sessionTimestamp ?? fileMtime,
      rawJson: { line, file, model: currentModel }
    });
  });
}

export function parseAiderUsage(config: ParserConfig): ParserResult {
  const warnings: string[] = [];
  const events: UsageEventInput[] = [];
  const roots = config.projectRoots.filter((root) => existsSync(root));
  if (roots.length === 0) {
    return { events, warnings: ["No project roots configured for Aider — set projectRoots in ~/.tokenizer/config.json"] };
  }
  for (const root of roots) {
    for (const file of walkForHistoryFiles(root)) {
      if (config.cursor && shouldSkipFile(file, config.cursor)) continue;
      parseHistoryFile(file, config, events, warnings);
      if (config.cursor) recordFile(file, config.cursor);
    }
  }
  return { events, warnings };
}
