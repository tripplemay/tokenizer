import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { UsageEventInput } from "@/shared/usage";
import {
  CodexUsageCounters,
  codexCanonicalSourceEventId,
  hasCodexUsage,
  maxCodexUsage,
  normalizeCodexUsage,
  positiveCodexDelta,
  readCodexTotalUsage
} from "@/shared/codex-usage";
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

  const highWater = new Map<string, CodexUsageCounters>();

  for (const file of walk(dir).sort()) {
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

        const lastUsage = normalizeCodexUsage(row.payload.info.last_token_usage);
        const totalUsage = readCodexTotalUsage(row);
        let usage = lastUsage;
        if (totalUsage && sessionId) {
          const previous = highWater.get(sessionId);
          usage = previous ? positiveCodexDelta(totalUsage, previous) : lastUsage;
          highWater.set(sessionId, previous ? maxCodexUsage(previous, totalUsage) : totalUsage);
        }
        const totalTokens = usage.totalTokens || usage.inputTokens + usage.outputTokens;
        if (!hasCodexUsage({ ...usage, totalTokens })) return;

        const occurredAt = row.timestamp ?? fallbackTime;
        const legacySourceEventId = `codex:${file}:${index + 1}:${occurredAt}`;
        const sourceEventId = codexCanonicalSourceEventId(sessionId, row, legacySourceEventId);
        if (!totalUsage) {
          const fingerprint = `${occurredAt}:${model ?? ""}:${usage.inputTokens}:${usage.outputTokens}:${usage.cachedInputTokens}:${usage.cacheWriteTokens}:${usage.reasoningOutputTokens}:${totalTokens}`;
          if (seenFingerprints.has(fingerprint)) return;
          seenFingerprints.add(fingerprint);
        }

        events.push({
          source: "codex",
          sourceEventId,
          projectName: inferProjectName(workspacePath),
          sessionId,
          workspacePath,
          model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cachedInputTokens: usage.cachedInputTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          reasoningOutputTokens: usage.reasoningOutputTokens,
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
