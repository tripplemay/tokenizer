import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const cursorPath = join(homedir(), ".tokenizer", "cursor.json");

export type FileFingerprint = { mtimeMs: number; size: number };

export type ParserCursor = {
  // Per-file (mtime, size) fingerprint. If the fingerprint matches what we
  // last saw, the parser can skip the file entirely. If the file grew or was
  // rewritten, the parser re-reads it and the server's createMany skipDuplicates
  // strips the overlap.
  files: Record<string, FileFingerprint>;
  // OpenCode keeps usage in SQLite. We track the highest message.time_created
  // we've already ingested so subsequent runs can WHERE time_created > cursor.
  opencodeLastTimeCreated: number;
};

export function emptyCursor(): ParserCursor {
  return { files: {}, opencodeLastTimeCreated: 0 };
}

export function readCursor(): ParserCursor {
  if (!existsSync(cursorPath)) return emptyCursor();
  try {
    const parsed = JSON.parse(readFileSync(cursorPath, "utf8")) as Partial<ParserCursor>;
    return {
      files: parsed.files ?? {},
      opencodeLastTimeCreated: parsed.opencodeLastTimeCreated ?? 0
    };
  } catch {
    return emptyCursor();
  }
}

export function writeCursor(cursor: ParserCursor) {
  mkdirSync(dirname(cursorPath), { recursive: true });
  writeFileSync(cursorPath, `${JSON.stringify(cursor, null, 2)}\n`);
}

export function shouldSkipFile(path: string, cursor: ParserCursor): boolean {
  const prev = cursor.files[path];
  if (!prev) return false;
  try {
    const stat = statSync(path);
    return stat.mtimeMs === prev.mtimeMs && stat.size === prev.size;
  } catch {
    return false;
  }
}

export function recordFile(path: string, cursor: ParserCursor): void {
  try {
    const stat = statSync(path);
    cursor.files[path] = { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    /* file vanished — leave cursor as-is */
  }
}

export function cloneCursor(cursor: ParserCursor): ParserCursor {
  return {
    files: { ...cursor.files },
    opencodeLastTimeCreated: cursor.opencodeLastTimeCreated
  };
}
