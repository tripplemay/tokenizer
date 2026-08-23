import Database from "better-sqlite3";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalizeTokenCount, UsageEventInput } from "@/shared/usage";
import { findWorkspaceFromPath, inferProjectName } from "@/cli/project";
import { ParserConfig, ParserResult } from "./types";

type OpenCodeRow = {
  message_id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  message_data: string;
  directory: string | null;
  path: string | null;
  project_id: string | null;
  agent: string | null;
  session_model: string | null;
  worktree: string | null;
  project_name: string | null;
};

// Windows needs no special-casing to work today: opencode bundles an XDG
// library with no win32 branch, so it resolves to
// `XDG_DATA_HOME || $HOME/.local/share` on every platform — already covered
// below. The LOCALAPPDATA entries are purely defensive: opencode's own
// dependencies already ship env-paths-style logic (`%LOCALAPPDATA%\<name>\Data`),
// so probing there costs one existsSync and survives a future switch.
export function openCodeDataDirs(homeDir: string, cwd: string): string[] {
  const localAppData = process.env.LOCALAPPDATA;
  const dirs = [
    process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, "opencode") : null,
    join(homeDir, ".local", "share", "opencode"),
    join(homeDir, "Library", "Application Support", "opencode"),
    join(homeDir, ".opencode"),
    join(homeDir, ".config", "opencode"),
    join(homeDir, ".cache", "opencode"),
    localAppData ? join(localAppData, "opencode") : null,
    localAppData ? join(localAppData, "opencode", "Data") : null,
    join(cwd, ".opencode")
  ].filter(Boolean) as string[];
  return Array.from(new Set(dirs));
}

function findOpenCodeDb(homeDir: string, cwd: string): string | null {
  for (const dir of openCodeDataDirs(homeDir, cwd)) {
    const db = join(dir, "opencode.db");
    if (existsSync(db)) return db;
  }
  return null;
}

function parseSessionModel(value: string | null): { id?: string; providerID?: string; variant?: string } | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as { id?: string; providerID?: string; variant?: string };
  } catch {
    return null;
  }
}

function timestampMsToIso(value: unknown, fallbackMs: number): string {
  const ms = typeof value === "number" && Number.isFinite(value) ? value : fallbackMs;
  return new Date(ms).toISOString();
}

function countTokenizedMessages(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare("select data from message").all() as { data: string }[];
    let count = 0;
    for (const row of rows) {
      try {
        const data = JSON.parse(row.data) as any;
        if (data.role === "assistant" && normalizeTokenCount(data.tokens?.total) > 0) count += 1;
      } catch {
        // Ignore malformed historical rows during diagnostics.
      }
    }
    return count;
  } finally {
    db.close();
  }
}

export function parseOpenCodeUsage(config: ParserConfig): ParserResult {
  const warnings: string[] = [];
  const events: UsageEventInput[] = [];
  const dbPath = findOpenCodeDb(config.homeDir, process.cwd());
  if (!dbPath) return { events, warnings: ["OpenCode database not found. Run tokenizer diagnose opencode to locate data files."] };

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  // Skip messages already covered by the durable queue cursor. The
  // cursor stores the highest m.time_created we've emitted; ">" (strict) is
  // safe because (deviceId, sourceEventId) is unique on the server side and
  // we always emit each message_id exactly once per file.
  const cutoff = config.cursor?.opencodeLastTimeCreated ?? 0;
  let maxTimeCreated = cutoff;
  try {
    const rows = db
      .prepare(
        `select
          m.id as message_id,
          m.session_id,
          m.time_created,
          m.time_updated,
          m.data as message_data,
          s.directory,
          s.path,
          s.project_id,
          s.agent,
          s.model as session_model,
          p.worktree,
          p.name as project_name
        from message m
        join session s on s.id = m.session_id
        left join project p on p.id = s.project_id
        where m.time_created > ?
        order by m.time_created asc`
      )
      .all(cutoff) as OpenCodeRow[];

    for (const row of rows) {
      if (row.time_created > maxTimeCreated) maxTimeCreated = row.time_created;
      try {
        const message = JSON.parse(row.message_data) as any;
        if (message.role !== "assistant") continue;

        const totalTokens = normalizeTokenCount(message.tokens?.total);
        if (totalTokens === 0) continue;

        const sessionModel = parseSessionModel(row.session_model);
        const workspacePath = findWorkspaceFromPath(message.path?.cwd ?? row.directory ?? row.worktree, config.projectRoots);
        const projectName = row.project_name || inferProjectName(workspacePath);
        const rawInputTokens = normalizeTokenCount(message.tokens?.input);
        const cacheWriteTokens = normalizeTokenCount(message.tokens?.cache?.write);
        const cachedInputTokens = normalizeTokenCount(message.tokens?.cache?.read);
        // New convention: inputTokens is the total input the model saw — raw
        // + cache write + cache read. The two cache buckets remain separate
        // fields so the dashboard can show the decomposition.
        const inputTokens = rawInputTokens + cacheWriteTokens + cachedInputTokens;
        const outputTokens = normalizeTokenCount(message.tokens?.output);
        const reasoningOutputTokens = normalizeTokenCount(message.tokens?.reasoning);

        events.push({
          source: "opencode",
          sourceEventId: `opencode:${row.message_id}`,
          projectName,
          sessionId: row.session_id,
          workspacePath,
          model: message.modelID ?? sessionModel?.id ?? null,
          inputTokens,
          outputTokens,
          cachedInputTokens,
          cacheWriteTokens,
          reasoningOutputTokens,
          totalTokens,
          costUsd: typeof message.cost === "number" ? message.cost : null,
          occurredAt: timestampMsToIso(message.time?.completed ?? message.time?.created, row.time_created),
          rawJson: {
            messageId: row.message_id,
            providerID: message.providerID ?? sessionModel?.providerID ?? null,
            cacheWriteTokens,
            agent: message.agent ?? row.agent ?? null,
            databasePath: dbPath,
            message,
            session: {
              id: row.session_id,
              directory: row.directory,
              path: row.path,
              projectId: row.project_id,
              agent: row.agent,
              model: sessionModel
            },
            project: {
              id: row.project_id,
              name: row.project_name,
              worktree: row.worktree
            }
          }
        });
      } catch (error) {
        warnings.push(`Failed to parse OpenCode message ${row.message_id}: ${(error as Error).message}`);
      }
    }
  } catch (error) {
    warnings.push(`Failed to read OpenCode database ${dbPath}: ${(error as Error).message}`);
  } finally {
    db.close();
  }

  if (config.cursor) config.cursor.opencodeLastTimeCreated = maxTimeCreated;

  return { events, warnings };
}

export function diagnoseOpenCode(homeDir: string, cwd: string): string[] {
  const found: string[] = [];
  for (const candidate of openCodeDataDirs(homeDir, cwd)) {
    if (!existsSync(candidate)) continue;
    found.push(candidate);

    const dbPath = join(candidate, "opencode.db");
    if (existsSync(dbPath)) {
      try {
        found.push(`  database: ${dbPath}`);
        found.push(`  tokenized messages: ${countTokenizedMessages(dbPath)}`);
      } catch (error) {
        found.push(`  database: ${dbPath}`);
        found.push(`  tokenized messages: unavailable (${(error as Error).message})`);
      }
    }

    for (const name of readdirSync(candidate)) {
      const full = join(candidate, name);
      const stat = statSync(full);
      if (stat.isFile() && /usage|session|log|jsonl|json|db/i.test(name)) found.push(`  ${full}`);
    }
  }
  return found;
}
