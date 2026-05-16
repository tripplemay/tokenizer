import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalizeTokenCount, UsageEventInput } from "@/shared/usage";
import { findWorkspaceFromPath, inferProjectName } from "@/cli/project";
import { ParserConfig, ParserResult } from "./types";

function walk(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) walk(full, files);
    else if (name.isFile() && name.name.endsWith(".jsonl")) files.push(full);
  }
  return files;
}

export function parseCodexUsage(config: ParserConfig): ParserResult {
  const dir = join(config.homeDir, ".codex", "sessions");
  const warnings: string[] = [];
  const events: UsageEventInput[] = [];
  if (!existsSync(dir)) return { events, warnings: [`Codex sessions directory not found: ${dir}`] };

  for (const file of walk(dir)) {
    let sessionId: string | null = null;
    let workspacePath: string | null = null;
    let model: string | null = null;
    const fallbackTime = statSync(file).mtime.toISOString();
    const lines = readFileSync(file, "utf8").split(/\r?\n/);

    lines.forEach((line, index) => {
      if (!line.trim()) return;
      try {
        const row = JSON.parse(line) as any;
        if (row.type === "session_meta") {
          sessionId = row.payload?.id ?? sessionId;
          workspacePath = findWorkspaceFromPath(row.payload?.cwd, config.projectRoots) ?? workspacePath;
          model = row.payload?.model ?? model;
          return;
        }
        if (row.type === "turn_context") {
          sessionId = row.payload?.session_id ?? sessionId;
          workspacePath = findWorkspaceFromPath(row.payload?.cwd, config.projectRoots) ?? workspacePath;
          model = row.payload?.model ?? model;
          return;
        }
        if (row.type !== "event_msg" || row.payload?.type !== "token_count" || !row.payload?.info?.last_token_usage) return;

        const usage = row.payload.info.last_token_usage;
        const codexInputTokens = normalizeTokenCount(usage.input_tokens);
        const cachedInputTokens = normalizeTokenCount(usage.cached_input_tokens);
        // Codex follows the OpenAI convention where input_tokens already includes the
        // cached_input_tokens subset. Subtract so inputTokens means "fresh non-cached
        // input", matching the Claude and OpenCode parsers.
        const inputTokens = Math.max(0, codexInputTokens - cachedInputTokens);
        const outputTokens = normalizeTokenCount(usage.output_tokens);
        const reasoningOutputTokens = normalizeTokenCount(usage.reasoning_output_tokens);
        const totalTokens = normalizeTokenCount(usage.total_tokens) || codexInputTokens + outputTokens;
        if (totalTokens === 0) return;

        events.push({
          source: "codex",
          sourceEventId: `codex:${file}:${index + 1}:${row.timestamp ?? fallbackTime}`,
          projectName: inferProjectName(workspacePath),
          sessionId,
          workspacePath,
          model,
          inputTokens,
          outputTokens,
          cachedInputTokens,
          reasoningOutputTokens,
          totalTokens,
          occurredAt: row.timestamp ?? fallbackTime,
          rawJson: row
        });
      } catch (error) {
        warnings.push(`Failed to parse Codex ${file}:${index + 1}: ${(error as Error).message}`);
      }
    });
  }

  return { events, warnings };
}
