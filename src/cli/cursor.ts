import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathCacheKey } from "@/shared/path";
import { writeFileAtomic } from "@/cli/atomic-file";

export const cursorPath = join(homedir(), ".tokenizer", "cursor.json");

export type FileFingerprint = { mtimeMs: number; size: number };

export type ParserCursor = {
  // Per-file (mtime, size) fingerprint. If the fingerprint matches what we
  // last saw, the parser can skip the file entirely. Append-only JSONL parsers
  // re-read a grown file for context but emit only rows beyond the saved size;
  // rewritten files are replayed from byte zero.
  files: Record<string, FileFingerprint>;
  // OpenCode keeps usage in SQLite. We track the highest message.time_created
  // we've already ingested so subsequent runs can WHERE time_created > cursor.
  opencodeLastTimeCreated: number;
  // Generation of the Claude JSONL parser that recorded the fingerprints.
  // When the parser's extraction semantics change (e.g. the v2 keep-last +
  // fallback-expansion fix), parseClaudeUsage drops the stale claude
  // fingerprints once so history gets re-parsed and corrected server-side.
  // 0 = written before versioning existed.
  claudeParserVersion: number;
};

export function emptyCursor(): ParserCursor {
  return { files: {}, opencodeLastTimeCreated: 0, claudeParserVersion: 0 };
}

export function readCursor(): ParserCursor {
  if (!existsSync(cursorPath)) return emptyCursor();
  try {
    const parsed = JSON.parse(readFileSync(cursorPath, "utf8")) as Partial<ParserCursor>;
    return {
      files: parsed.files ?? {},
      opencodeLastTimeCreated: parsed.opencodeLastTimeCreated ?? 0,
      claudeParserVersion: parsed.claudeParserVersion ?? 0
    };
  } catch {
    return emptyCursor();
  }
}

export function writeCursor(cursor: ParserCursor) {
  writeFileAtomic(cursorPath, `${JSON.stringify(cursor, null, 2)}\n`);
}

export function shouldSkipFile(path: string, cursor: ParserCursor): boolean {
  // Keyed by canonical form, not the raw string: NTFS resolves "C:\P\a" and
  // "c:\p\a" to one file, and keying on exact case would re-parse it and
  // re-emit every event. Identity on POSIX, so existing cursors still hit.
  const prev = cursor.files[pathCacheKey(path)];
  if (!prev) return false;
  try {
    const stat = statSync(path);
    return stat.mtimeMs === prev.mtimeMs && stat.size === prev.size;
  } catch {
    return false;
  }
}

// Codex, Claude project, and Kimi wire JSONL files are append-only. Some host
// tools touch their mtime without changing content; for these logs, equal byte
// size means there is no new complete or partial data to inspect.
export function shouldSkipAppendOnlyFile(path: string, cursor: ParserCursor): boolean {
  const prev = cursor.files[pathCacheKey(path)];
  if (!prev) return false;
  try {
    return statSync(path).size === prev.size;
  } catch {
    return false;
  }
}

// For append-only logs, return the byte offset already covered by the cursor.
// A shrink is replayed from byte zero. Callers still scan the prefix when they
// need session context; this offset only gates event emission.
export function appendStartOffset(path: string, cursor: ParserCursor): number {
  const prev = cursor.files[pathCacheKey(path)];
  if (!prev) return 0;
  try {
    return statSync(path).size > prev.size ? prev.size : 0;
  } catch {
    return 0;
  }
}

export function recordFile(path: string, cursor: ParserCursor, parsedSize?: number): void {
  try {
    const stat = statSync(path);
    // JSONL files may grow between readFileSync and this stat. Never advance
    // the cursor past bytes the parser actually inspected.
    cursor.files[pathCacheKey(path)] = { mtimeMs: stat.mtimeMs, size: parsedSize ?? stat.size };
  } catch {
    /* file vanished — leave cursor as-is */
  }
}

export function cloneCursor(cursor: ParserCursor): ParserCursor {
  return {
    files: { ...cursor.files },
    opencodeLastTimeCreated: cursor.opencodeLastTimeCreated,
    claudeParserVersion: cursor.claudeParserVersion
  };
}
