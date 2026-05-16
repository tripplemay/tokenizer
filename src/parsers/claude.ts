import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalizeTokenCount, UsageEventInput } from "@/shared/usage";
import { findWorkspaceFromPath, inferProjectName } from "@/cli/project";
import { ParserConfig, ParserResult } from "./types";

export function parseClaudeUsage(config: ParserConfig): ParserResult {
  const projectsDir = join(config.homeDir, ".claude", "projects");
  const legacyDir = join(config.homeDir, ".claude", "usage-data", "session-meta");
  const warnings: string[] = [];
  const events: UsageEventInput[] = [];

  // The jsonl format is per-message and authoritative; legacy session-meta stores
  // cumulative totals per session and is only consulted as a fallback to avoid
  // double-counting the same session across both sources.
  if (existsSync(projectsDir)) {
    parseProjectJsonl(projectsDir, config, events, warnings);
  } else if (existsSync(legacyDir)) {
    parseLegacySessionMeta(legacyDir, config, events, warnings);
  } else {
    warnings.push(`Claude usage directories not found: ${projectsDir}, ${legacyDir}`);
  }
  return { events, warnings };
}

function parseLegacySessionMeta(dir: string, config: ParserConfig, events: UsageEventInput[], warnings: string[]) {
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const file = join(dir, name);
    try {
      const text = readFileSync(file, "utf8");
      const json = JSON.parse(text) as Record<string, unknown>;
      const inputTokens = normalizeTokenCount(json.input_tokens);
      const outputTokens = normalizeTokenCount(json.output_tokens);
      if (inputTokens === 0 && outputTokens === 0) continue;

      const sessionId = String(json.session_id ?? json.id ?? name.replace(/\.json$/, ""));
      const rawWorkspace = typeof json.cwd === "string" ? json.cwd : typeof json.workspace === "string" ? json.workspace : null;
      const workspacePath = findWorkspaceFromPath(rawWorkspace, config.projectRoots);
      const mtime = statSync(file).mtime.toISOString();

      events.push({
        source: "claude-code",
        sourceEventId: `claude-legacy:${sessionId}`,
        projectName: inferProjectName(workspacePath),
        sessionId,
        workspacePath,
        model: typeof json.model === "string" ? json.model : null,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        occurredAt: typeof json.updated_at === "string" ? json.updated_at : mtime,
        rawJson: json
      });
    } catch (error) {
      warnings.push(`Failed to parse Claude file ${file}: ${(error as Error).message}`);
    }
  }
}

function walkJsonl(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkJsonl(full, files);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(full);
  }
  return files;
}

function parseProjectJsonl(projectsDir: string, config: ParserConfig, events: UsageEventInput[], warnings: string[]) {
  for (const file of walkJsonl(projectsDir)) {
    const fallbackTime = statSync(file).mtime.toISOString();
    const lines = readFileSync(file, "utf8").replace(/\u0000/g, "").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      try {
        const row = JSON.parse(line) as any;
        if (row.type !== "assistant" || row.message?.role !== "assistant") return;
        const usage = row.message.usage;
        if (!usage) return;

        const inputTokens = normalizeTokenCount(usage.input_tokens);
        const outputTokens = normalizeTokenCount(usage.output_tokens);
        const cachedInputTokens = normalizeTokenCount(usage.cache_read_input_tokens);
        const cacheCreationTokens = normalizeTokenCount(usage.cache_creation_input_tokens);
        const totalTokens = inputTokens + outputTokens + cachedInputTokens + cacheCreationTokens;
        if (totalTokens === 0) return;

        const workspacePath = findWorkspaceFromPath(row.cwd, config.projectRoots);
        const messageId = row.message.id ?? row.uuid ?? `${file}:${index + 1}`;
        events.push({
          source: "claude-code",
          sourceEventId: `claude-jsonl:${messageId}:${row.uuid ?? index + 1}`,
          projectName: inferProjectName(workspacePath),
          sessionId: row.sessionId ?? null,
          workspacePath,
          model: typeof row.message.model === "string" ? row.message.model : null,
          inputTokens: inputTokens + cacheCreationTokens,
          outputTokens,
          cachedInputTokens,
          totalTokens,
          occurredAt: typeof row.timestamp === "string" ? row.timestamp : fallbackTime,
          rawJson: row
        });
      } catch (error) {
        warnings.push(`Failed to parse Claude jsonl ${file}:${index + 1}: ${(error as Error).message}`);
      }
    });
  }
}
