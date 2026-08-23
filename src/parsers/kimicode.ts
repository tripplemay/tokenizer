import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { normalizeTokenCount, UsageEventInput } from "@/shared/usage";
import { findWorkspaceFromPath, inferProjectName } from "@/cli/project";
import { appendStartOffset, recordFile, shouldSkipAppendOnlyFile } from "@/cli/cursor";
import { readJsonlFile } from "@/parsers/jsonl";
import { ParserConfig, ParserResult } from "./types";

const KIMI_DIR = ".kimi-code";

// Recursively collect every `wire.jsonl` under the sessions tree. Each agent of
// a session (main + sub-agents) writes its own wire.jsonl; all of them hold
// real, independent API turns and must be counted.
function walkWire(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkWire(full, files);
    else if (entry.isFile() && entry.name === "wire.jsonl") files.push(full);
  }
  return files;
}

// Kimi Code records the workspace root per session in state.json, and mirrors
// it in the top-level session_index.jsonl. We prefer the co-located state.json
// and fall back to the index.
function loadSessionIndex(homeDir: string): Map<string, string> {
  const map = new Map<string, string>();
  const indexPath = join(homeDir, KIMI_DIR, "session_index.jsonl");
  if (!existsSync(indexPath)) return map;
  for (const line of readFileSync(indexPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as { sessionDir?: string; workDir?: string };
      if (row.sessionDir && row.workDir) map.set(row.sessionDir, row.workDir);
    } catch {
      // Ignore malformed index lines.
    }
  }
  return map;
}

function readWorkDir(sessionDir: string, index: Map<string, string>): string | null {
  const statePath = join(sessionDir, "state.json");
  if (existsSync(statePath)) {
    try {
      const state = JSON.parse(readFileSync(statePath, "utf8")) as { workDir?: string };
      if (state.workDir) return state.workDir;
    } catch {
      // Fall through to the session index.
    }
  }
  return index.get(sessionDir) ?? null;
}

export function parseKimiCodeUsage(config: ParserConfig): ParserResult {
  const root = join(config.homeDir, KIMI_DIR, "sessions");
  const warnings: string[] = [];
  const events: UsageEventInput[] = [];
  if (!existsSync(root)) return { events, warnings: [`Kimi Code sessions directory not found: ${root}`] };

  const sessionIndex = loadSessionIndex(config.homeDir);
  const workDirCache = new Map<string, string | null>();

  for (const file of walkWire(root)) {
    if (config.cursor && shouldSkipAppendOnlyFile(file, config.cursor)) continue;
    const emitAfter = config.cursor ? appendStartOffset(file, config.cursor) : 0;
    // .../<sessionDir>/agents/<agentId>/wire.jsonl -> climb three levels.
    const sessionDir = dirname(dirname(dirname(file)));
    if (!workDirCache.has(sessionDir)) workDirCache.set(sessionDir, readWorkDir(sessionDir, sessionIndex));
    const workspacePath = findWorkspaceFromPath(workDirCache.get(sessionDir), config.projectRoots);
    const projectName = inferProjectName(workspacePath);
    const sessionId = basename(sessionDir);
    const fallbackTime = statSync(file).mtime.toISOString();
    const jsonl = readJsonlFile(file);

    jsonl.lines.forEach(({ text: line, lineNumber, endOffset }) => {
      if (!line.trim()) return;
      if (endOffset <= emitAfter) return;
      try {
        const row = JSON.parse(line) as any;
        // Only per-turn usage rows. Each is the incremental usage of one API
        // request, so summing them is correct. Ignore any future cumulative
        // "session" scope (would double-count) and every non-usage wire event.
        if (row.type !== "usage.record" || row.usageScope !== "turn" || !row.usage) return;

        const usage = row.usage;
        const cachedInputTokens = normalizeTokenCount(usage.inputCacheRead);
        const cacheWriteTokens = normalizeTokenCount(usage.inputCacheCreation);
        // inputTokens = total input the model saw (fresh + cache read + cache
        // write), matching the project-wide convention; the two cache buckets
        // stay as separate subsets for the dashboard decomposition.
        const inputTokens = normalizeTokenCount(usage.inputOther) + cachedInputTokens + cacheWriteTokens;
        const outputTokens = normalizeTokenCount(usage.output);
        const totalTokens = inputTokens + outputTokens;
        if (totalTokens === 0) return;

        const occurredAt =
          typeof row.time === "number" && Number.isFinite(row.time) ? new Date(row.time).toISOString() : fallbackTime;

        events.push({
          source: "kimicode",
          sourceEventId: `kimicode:${file}:${lineNumber}:${row.time ?? fallbackTime}`,
          projectName,
          sessionId,
          workspacePath,
          model: row.model ?? null,
          inputTokens,
          outputTokens,
          cachedInputTokens,
          cacheWriteTokens,
          totalTokens,
          occurredAt,
          rawJson: row
        });
      } catch (error) {
        warnings.push(`Failed to parse Kimi Code ${file}:${lineNumber}: ${(error as Error).message}`);
      }
    });
    if (config.cursor) recordFile(file, config.cursor, jsonl.byteLength);
  }

  return { events, warnings };
}

export function diagnoseKimiCode(homeDir: string): string[] {
  const root = join(homeDir, KIMI_DIR, "sessions");
  const found: string[] = [];
  if (!existsSync(root)) return found;
  found.push(root);

  const sessionIndex = loadSessionIndex(homeDir);
  const workDirCache = new Map<string, string | null>();
  for (const file of walkWire(root)) {
    const sessionDir = dirname(dirname(dirname(file)));
    if (!workDirCache.has(sessionDir)) workDirCache.set(sessionDir, readWorkDir(sessionDir, sessionIndex));
    let turns = 0;
    try {
      for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line) as any;
          if (row.type === "usage.record" && row.usageScope === "turn") turns += 1;
        } catch {
          // Ignore malformed lines during diagnostics.
        }
      }
    } catch {
      // Unreadable wire file — still report its path below.
    }
    found.push(`  ${file} (workDir: ${workDirCache.get(sessionDir) ?? "unknown"}, usage.record turns: ${turns})`);
  }
  return found;
}
