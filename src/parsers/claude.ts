import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalizeTokenCount, UsageEventInput } from "@/shared/usage";
import { findWorkspaceFromPath, inferProjectName } from "@/cli/project";
import { ParserConfig, ParserResult } from "./types";

function hash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

export function parseClaudeUsage(config: ParserConfig): ParserResult {
  const dir = join(config.homeDir, ".claude", "usage-data", "session-meta");
  const warnings: string[] = [];
  const events: UsageEventInput[] = [];
  if (!existsSync(dir)) return { events, warnings: [`Claude usage directory not found: ${dir}`] };

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
        sourceEventId: `claude:${sessionId}:${hash(`${mtime}:${text}`)}`,
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

  return { events, warnings };
}
