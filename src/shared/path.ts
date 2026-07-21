// Windows path portability, kept in one place.
//
// Design constraint that shapes every function here: `workspacePath` is the
// server's `userId_workspacePath` unique index, and absolute paths are baked
// into `sourceEventId` (which is the ingest dedup key). So an existing
// POSIX install must observe *byte-identical* output — anything else
// re-ingests its whole history as new events and duplicates Project rows.
//
// That is why detection is driven by the **shape of the string**, not by
// `process.platform`: a POSIX path can then be proven to flow through
// untouched, regardless of where the code runs.

// "C:", "C:\", "C:/" — the ":" makes this unambiguous; no POSIX absolute
// path can collide with it.
const DRIVE_RE = /^([A-Za-z]):([\\/]|$)/;
const UNC_BACKSLASH_RE = /^\\\\/;
const UNC_SLASH_RE = /^\/\//;

/** True when the string is unambiguously a Windows-native absolute path. */
export function isWindowsPath(value: string): boolean {
  if (!value) return false;
  return DRIVE_RE.test(value) || UNC_BACKSLASH_RE.test(value);
}

function toBackslash(value: string): string {
  return value.replace(/[\\/]+/g, "\\");
}

/**
 * Canonical spelling of a workspace path.
 *
 * Windows paths reach us in two different spellings for the same directory:
 * `git rev-parse --show-toplevel` prints `C:/Users/me/proj` while the agent
 * log files record `C:\Users\me\proj`. Left alone they key as two distinct
 * projects. This collapses them to the native backslash form with an
 * uppercase drive letter.
 *
 * POSIX paths are returned identically — including any trailing slash, which
 * is deliberately *not* tidied up (see the file header).
 *
 * `platform` is injectable so both branches are testable from either OS; it
 * only affects the forward-slash UNC form, which is genuinely ambiguous
 * ("//x" is a legal POSIX path).
 */
export function normalizeWorkspacePath(value: string, platform: string = process.platform): string {
  if (!value) return value;

  const drive = DRIVE_RE.exec(value);
  if (drive) {
    const letter = drive[1].toUpperCase();
    const body = toBackslash(value.slice(2)).replace(/\\+$/, "");
    // "C:" alone is drive-relative, not the drive root — always emit "C:\".
    return `${letter}:${body || "\\"}`;
  }

  const isUnc = UNC_BACKSLASH_RE.test(value) || (platform === "win32" && UNC_SLASH_RE.test(value));
  if (!isUnc) return value;

  return `\\\\${toBackslash(value.slice(2)).replace(/\\+$/, "")}`;
}

/**
 * Key for caches and cursors that index files by path.
 *
 * NTFS is case-insensitive, so `C:\Proj\a.jsonl` and `c:\proj\a.jsonl` are one
 * file; keying on exact case makes the cursor treat it as two, re-parsing it
 * and re-emitting every event it contains. POSIX filesystems can be
 * case-sensitive, so there the key stays exact.
 */
export function pathCacheKey(value: string, platform?: string): string {
  const normalized = normalizeWorkspacePath(value, platform);
  return isWindowsPath(normalized) ? normalized.toLowerCase() : normalized;
}

/**
 * Whether `child` is `parent` or lives inside it, tolerant of separator style
 * and (on Windows) letter case.
 *
 * Compares against `parent` plus a trailing separator so a sibling that merely
 * shares a prefix — `.claude-backup` vs `.claude` — is correctly excluded.
 */
export function isPathUnder(child: string, parent: string, platform?: string): boolean {
  const childKey = pathCacheKey(child, platform);
  const parentKey = pathCacheKey(parent, platform);
  if (childKey === parentKey) return true;

  const separator = isWindowsPath(parentKey) ? "\\" : "/";
  const prefix = parentKey.endsWith(separator) ? parentKey : `${parentKey}${separator}`;
  return childKey.startsWith(prefix);
}

/**
 * Directory names making up a path, with the drive letter dropped.
 *
 * Used for "does this path live in a directory called X" tests. Splitting the
 * normalized form matters: on POSIX a backslash is an ordinary filename
 * character and must never act as a separator.
 */
export function pathSegments(value: string, platform?: string): string[] {
  if (!value) return [];
  const normalized = normalizeWorkspacePath(value, platform);
  if (!isWindowsPath(normalized)) return normalized.split("/").filter(Boolean);
  return normalized.replace(DRIVE_RE, "").split("\\").filter(Boolean);
}
