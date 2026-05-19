import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalizeTokenCount, UsageEventInput } from "@/shared/usage";
import { findWorkspaceFromPath, inferProjectName } from "@/cli/project";
import { recordFile, shouldSkipFile } from "@/cli/cursor";
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
    if (config.cursor && shouldSkipFile(file, config.cursor)) continue;
    let sessionId: string | null = null;
    let workspacePath: string | null = null;
    let model: string | null = null;
    const fallbackTime = statSync(file).mtime.toISOString();
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    // Codex sometimes writes the same `token_count` event multiple times in
    // one session file (identical timestamp + identical usage numbers, on
    // different lines). The old sourceEventId included the line index, so
    // each duplicate row got a different key and the server's unique
    // constraint did not catch them — see the 1432-row regression on
    // HanteenWongdeMacBook-Air's May-14 rollout. Dedupe per-file on the
    // content fingerprint and keep the first occurrence.
    const seenFingerprints = new Set<string>();

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
        // Codex follows the OpenAI convention: input_tokens already includes the
        // cached_input_tokens subset. We store inputTokens as-is, matching the
        // new project-wide convention where inputTokens means "total input the
        // model saw" with cached as a separate subset. Codex does not expose a
        // cache_write counter, so cacheWriteTokens stays 0.
        const inputTokens = normalizeTokenCount(usage.input_tokens);
        const cachedInputTokens = normalizeTokenCount(usage.cached_input_tokens);
        const outputTokens = normalizeTokenCount(usage.output_tokens);
        const reasoningOutputTokens = normalizeTokenCount(usage.reasoning_output_tokens);
        const totalTokens = normalizeTokenCount(usage.total_tokens) || inputTokens + outputTokens;
        if (totalTokens === 0) return;

        const occurredAt = row.timestamp ?? fallbackTime;
        const fingerprint = `${occurredAt}:${model ?? ""}:${inputTokens}:${outputTokens}:${cachedInputTokens}:${reasoningOutputTokens}`;
        if (seenFingerprints.has(fingerprint)) return;
        seenFingerprints.add(fingerprint);

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
          cacheWriteTokens: 0,
          reasoningOutputTokens,
          totalTokens,
          occurredAt: row.timestamp ?? fallbackTime,
          rawJson: row
        });
      } catch (error) {
        warnings.push(`Failed to parse Codex ${file}:${index + 1}: ${(error as Error).message}`);
      }
    });
    if (config.cursor) recordFile(file, config.cursor);
  }

  return { events, warnings };
}
