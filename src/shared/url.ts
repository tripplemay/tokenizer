// Return the url only if it is a plain http(s) URL, else null. Used to keep an
// attacker-influenced sourceUrl (e.g. an LLM-suggested pricing page) from ever
// being rendered as a javascript:/data: href. Applied both where the url enters
// the DB and defensively where it is read for display.
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

const CALLBACK_ORIGIN = "https://callback.invalid";
const CALLBACK_CONTROL_CHARACTER_RE = /[\u0000-\u001F\u007F]/;
const MAX_CALLBACK_DECODE_PASSES = 16;

function isSameOriginCallbackPath(value: string): boolean {
  // Keep the value byte-for-byte stable for callers, but reject whitespace and
  // controls that URL parsing would otherwise normalize away.
  if (!value || value !== value.trim() || CALLBACK_CONTROL_CHARACTER_RE.test(value)) return false;
  if (!value.startsWith("/") || value.startsWith("//")) return false;

  try {
    const parsed = new URL(value, CALLBACK_ORIGIN);
    return parsed.origin === CALLBACK_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * Return a callback URL only when it remains an absolute, same-origin path.
 *
 * URL parsing treats backslashes as path separators and decodes can reveal a
 * protocol-relative URL, so validate both the supplied value and each decoded
 * representation before returning the original string.
 */
export function safeCallbackPath(path: string | null | undefined): string {
  if (typeof path !== "string" || !isSameOriginCallbackPath(path)) return "/";

  let decoded = path;
  for (let pass = 0; pass < MAX_CALLBACK_DECODE_PASSES; pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return path;
      if (!isSameOriginCallbackPath(next)) return "/";
      decoded = next;
    } catch {
      return "/";
    }
  }

  // Excessive nested encoding is ambiguous and should fail closed rather than
  // returning a value that has not completed the decode checks above.
  return "/";
}
