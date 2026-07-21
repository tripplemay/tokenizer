import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalizeTokenCount, UsageEventInput } from "@/shared/usage";
import { findWorkspaceFromPath, inferProjectName } from "@/cli/project";
import { recordFile, shouldSkipFile } from "@/cli/cursor";
import { isPathUnder, pathSegments } from "@/shared/path";
import { ParserConfig, ParserResult } from "./types";

// Generation of this parser's extraction semantics. Bump when re-parsing
// already-fingerprinted files would produce different events (the server
// corrects rows in place on re-upload).
//   1 — keep-first row per message.id (implicit, pre-versioning)
//   2 — 2026-07-03: usage/model from the LAST streamed row (fixes the ~17%
//       output undercount) + mid-request fallback expansion via usage.iterations
export const CLAUDE_PARSER_VERSION = 2;

export function parseClaudeUsage(config: ParserConfig): ParserResult {
  const projectsDir = join(config.homeDir, ".claude", "projects");
  const legacyDir = join(config.homeDir, ".claude", "usage-data", "session-meta");
  const warnings: string[] = [];
  const events: UsageEventInput[] = [];

  // One-time invalidation when the parser generation changed: drop the
  // fingerprints of every claude-owned file so history is re-parsed once.
  // Other parsers' fingerprints (codex, aider) are left untouched.
  if (config.cursor && config.cursor.claudeParserVersion !== CLAUDE_PARSER_VERSION) {
    const claudeRoot = join(config.homeDir, ".claude");
    for (const path of Object.keys(config.cursor.files)) {
      // Separator- and case-tolerant: on Windows the cursor keys are
      // "C:\...\.claude\..." and a hardcoded "/" test silently matches
      // nothing, leaving stale fingerprints in place forever.
      if (isPathUnder(path, claudeRoot) || pathSegments(path).includes(".claude")) {
        delete config.cursor.files[path];
      }
    }
    config.cursor.claudeParserVersion = CLAUDE_PARSER_VERSION;
  }

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

type UsageNumbers = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
};

// New convention: inputTokens is the total input the model saw (incl. both
// cache write and cache read). cachedInputTokens / cacheWriteTokens remain
// as decomposed subsets.
function usageNumbers(usage: Record<string, unknown>): UsageNumbers {
  const rawInput = normalizeTokenCount(usage.input_tokens);
  const cacheWriteTokens = normalizeTokenCount(usage.cache_creation_input_tokens);
  const cachedInputTokens = normalizeTokenCount(usage.cache_read_input_tokens);
  const outputTokens = normalizeTokenCount(usage.output_tokens);
  const inputTokens = rawInput + cacheWriteTokens + cachedInputTokens;
  return { inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens, totalTokens: inputTokens + outputTokens };
}

type MessageGroup = {
  messageId: string;
  firstRow: any;
  firstRef: string;
  lastRow: any;
  // from/to of a {type:"fallback"} content block seen on any row of the group.
  blockFallbackFrom: string | null;
  blockFallbackTo: string | null;
};

function scanFallbackBlock(row: any, group: MessageGroup) {
  const content = row.message?.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block && typeof block === "object" && (block as any).type === "fallback") {
      const from = (block as any).from?.model;
      const to = (block as any).to?.model;
      if (typeof from === "string") group.blockFallbackFrom = from;
      if (typeof to === "string") group.blockFallbackTo = to;
    }
  }
}

function modelOf(row: any): string | null {
  return typeof row.message?.model === "string" ? row.message.model : null;
}

function parseProjectJsonl(projectsDir: string, config: ParserConfig, events: UsageEventInput[], warnings: string[]) {
  for (const file of walkJsonl(projectsDir)) {
    if (config.cursor && shouldSkipFile(file, config.cursor)) continue;
    const fallbackTime = statSync(file).mtime.toISOString();
    // Claude Code streams several rows per assistant message (same message.id,
    // different per-line uuid): early rows carry a placeholder usage snapshot,
    // only the last row has the final bill — and on a mid-request model
    // fallback the last rows carry the new model plus a per-model
    // usage.iterations breakdown. Group rows by message.id: identity (the
    // sourceEventId and occurredAt) comes from the FIRST row so it stays
    // stable across partial parses of a still-growing file; usage and model
    // come from the LAST row.
    const groups = new Map<string, MessageGroup>();
    const order: string[] = [];
    let missingIdRows = 0;
    const lines = readFileSync(file, "utf8").replace(/\u0000/g, "").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      try {
        const row = JSON.parse(line) as any;
        if (row.type !== "assistant" || row.message?.role !== "assistant") return;
        if (!row.message.usage) return;

        // Without message.id, grouping degrades to per-line — exactly the
        // streamed-snapshot double-count this parser exists to avoid. Warn so
        // an upstream format change is observable instead of silent.
        if (row.message.id == null) missingIdRows += 1;
        const messageId = row.message.id ?? row.uuid ?? `${file}:${index + 1}`;
        const existing = groups.get(messageId);
        if (!existing) {
          const group: MessageGroup = {
            messageId,
            firstRow: row,
            // Identity assumes Claude Code JSONL files are append-only (they
            // are in practice; compaction writes new files). If an earlier
            // row of a message were ever rewritten away, the next parse
            // would mint a different ref and the event would double-count
            // instead of correcting in place.
            firstRef: String(row.uuid ?? index + 1),
            lastRow: row,
            blockFallbackFrom: null,
            blockFallbackTo: null
          };
          scanFallbackBlock(row, group);
          groups.set(messageId, group);
          order.push(messageId);
        } else {
          existing.lastRow = row;
          scanFallbackBlock(row, existing);
        }
      } catch (error) {
        warnings.push(`Failed to parse Claude jsonl ${file}:${index + 1}: ${(error as Error).message}`);
      }
    });

    if (missingIdRows > 0) {
      warnings.push(`Claude jsonl ${file}: ${missingIdRows} assistant rows lack message.id; grouped per-line`);
    }
    for (const messageId of order) {
      emitGroupEvents(groups.get(messageId)!, config, events, warnings, fallbackTime);
    }
    if (config.cursor) recordFile(file, config.cursor);
  }
}

function emitGroupEvents(group: MessageGroup, config: ParserConfig, events: UsageEventInput[], warnings: string[], fallbackTime: string) {
  const { firstRow, lastRow } = group;
  const usage = lastRow.message.usage as Record<string, unknown>;
  const finalNumbers = usageNumbers(usage);
  const finalModel = modelOf(lastRow);
  const occurredAt = typeof firstRow.timestamp === "string" ? firstRow.timestamp : fallbackTime;
  const workspacePath = findWorkspaceFromPath(firstRow.cwd, config.projectRoots);
  const baseId = `claude-jsonl:${group.messageId}:${group.firstRef}`;

  const cacheCreationDetail = (usage.cache_creation ?? {}) as Record<string, unknown>;
  const serverToolUse = (usage.server_tool_use ?? {}) as Record<string, unknown>;
  const serviceTier = typeof usage.service_tier === "string" ? usage.service_tier : null;

  const shared = {
    source: "claude-code" as const,
    projectName: inferProjectName(workspacePath),
    sessionId: (firstRow.sessionId ?? null) as string | null,
    workspacePath,
    serviceTier,
    occurredAt
  };

  // A mid-request fallback (or retry) bills each attempt separately; the
  // final row's usage.iterations carries the per-model breakdown. Emit one
  // event per non-final iteration so token and cost attribution follow the
  // model that actually served each segment.
  const iterations = Array.isArray(usage.iterations)
    ? (usage.iterations as unknown[]).filter((it): it is Record<string, unknown> => !!it && typeof it === "object")
    : [];
  let fallbackFromModel: string | null = null;
  if (iterations.length >= 2) {
    // Double-count safety hinges on the top-level usage mirroring the LAST
    // iteration only (never a cumulative sum) — that is what the API emits
    // today. Warn loudly if the shape ever drifts.
    if (usageNumbers(iterations[iterations.length - 1]).totalTokens !== finalNumbers.totalTokens) {
      warnings.push(
        `Claude jsonl message ${group.messageId}: final usage disagrees with its last usage iteration; segments may double-count`
      );
    }
    for (let i = 0; i < iterations.length - 1; i += 1) {
      const iteration = iterations[i];
      const segNumbers = usageNumbers(iteration);
      if (segNumbers.totalTokens === 0) continue;
      const segModel = typeof iteration.model === "string" ? iteration.model : finalModel;
      const rawNextModel = iterations[i + 1].model;
      const nextModel = typeof rawNextModel === "string" ? rawNextModel : finalModel;
      const segCacheDetail = (iteration.cache_creation ?? {}) as Record<string, unknown>;
      events.push({
        ...shared,
        sourceEventId: `${baseId}:iter${i}`,
        model: segModel,
        ...segNumbers,
        cacheEphemeral5mInputTokens: normalizeTokenCount(segCacheDetail.ephemeral_5m_input_tokens),
        cacheEphemeral1hInputTokens: normalizeTokenCount(segCacheDetail.ephemeral_1h_input_tokens),
        fallbackToModel: segModel !== nextModel ? nextModel : null,
        rawJson: { messageId: group.messageId, iteration: i, ...iteration }
      });
    }
    const previousModel = iterations[iterations.length - 2]?.model;
    if (typeof previousModel === "string" && previousModel !== finalModel) fallbackFromModel = previousModel;
  }
  if (!fallbackFromModel && group.blockFallbackFrom && group.blockFallbackFrom !== finalModel) {
    fallbackFromModel = group.blockFallbackFrom;
  }

  if (finalNumbers.totalTokens === 0) return;
  events.push({
    ...shared,
    sourceEventId: baseId,
    model: finalModel,
    ...finalNumbers,
    cacheEphemeral5mInputTokens: normalizeTokenCount(cacheCreationDetail.ephemeral_5m_input_tokens),
    cacheEphemeral1hInputTokens: normalizeTokenCount(cacheCreationDetail.ephemeral_1h_input_tokens),
    webSearchRequests: normalizeTokenCount(serverToolUse.web_search_requests),
    webFetchRequests: normalizeTokenCount(serverToolUse.web_fetch_requests),
    fallbackFromModel,
    rawJson: lastRow
  });
}
