import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalizeTokenCount, UsageEventInput } from "@/shared/usage";
import { findWorkspaceFromPath, inferProjectName } from "@/cli/project";
import { recordFile, shouldSkipFile } from "@/cli/cursor";
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
    if (config.cursor && shouldSkipFile(file, config.cursor)) continue;
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
    if (config.cursor) recordFile(file, config.cursor);
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
    if (config.cursor && shouldSkipFile(file, config.cursor)) continue;
    const fallbackTime = statSync(file).mtime.toISOString();
    const lines = readFileSync(file, "utf8").replace(/\u0000/g, "").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      try {
        const row = JSON.parse(line) as any;
        if (row.type !== "assistant" || row.message?.role !== "assistant") return;
        const usage = row.message.usage;
        if (!usage) return;

        const rawInput = normalizeTokenCount(usage.input_tokens);
        const cacheCreation = normalizeTokenCount(usage.cache_creation_input_tokens);
        const cacheRead = normalizeTokenCount(usage.cache_read_input_tokens);
        const outputTokens = normalizeTokenCount(usage.output_tokens);
        // New convention: inputTokens is the total input the model saw (incl.
        // both cache write and cache read). cachedInputTokens / cacheWriteTokens
        // remain as decomposed subsets.
        const inputTokens = rawInput + cacheCreation + cacheRead;
        const totalTokens = inputTokens + outputTokens;
        if (totalTokens === 0) return;

        const cacheCreationDetail = (usage.cache_creation ?? {}) as Record<string, unknown>;
        const cacheEphemeral5m = normalizeTokenCount(cacheCreationDetail.ephemeral_5m_input_tokens);
        const cacheEphemeral1h = normalizeTokenCount(cacheCreationDetail.ephemeral_1h_input_tokens);

        const serverToolUse = (usage.server_tool_use ?? {}) as Record<string, unknown>;
        const webSearchRequests = normalizeTokenCount(serverToolUse.web_search_requests);
        const webFetchRequests = normalizeTokenCount(serverToolUse.web_fetch_requests);

        const serviceTier = typeof usage.service_tier === "string" ? usage.service_tier : null;

        const workspacePath = findWorkspaceFromPath(row.cwd, config.projectRoots);
        const messageId = row.message.id ?? row.uuid ?? `${file}:${index + 1}`;
        events.push({
          source: "claude-code",
          sourceEventId: `claude-jsonl:${messageId}:${row.uuid ?? index + 1}`,
          projectName: inferProjectName(workspacePath),
          sessionId: row.sessionId ?? null,
          workspacePath,
          model: typeof row.message.model === "string" ? row.message.model : null,
          inputTokens,
          outputTokens,
          cachedInputTokens: cacheRead,
          cacheWriteTokens: cacheCreation,
          totalTokens,
          cacheEphemeral5mInputTokens: cacheEphemeral5m,
          cacheEphemeral1hInputTokens: cacheEphemeral1h,
          webSearchRequests,
          webFetchRequests,
          serviceTier,
          occurredAt: typeof row.timestamp === "string" ? row.timestamp : fallbackTime,
          rawJson: row
        });
      } catch (error) {
        warnings.push(`Failed to parse Claude jsonl ${file}:${index + 1}: ${(error as Error).message}`);
      }
    });
    if (config.cursor) recordFile(file, config.cursor);
  }
}
