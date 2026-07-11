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
