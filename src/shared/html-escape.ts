const HTML_ESCAPE_RE = /[&<>"'`]/g;

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;"
};

/** Escape text before inserting it into an HTML string consumed by ApexCharts. */
export function escapeHtml(value: string): string {
  return value.replace(HTML_ESCAPE_RE, (character) => HTML_ENTITIES[character]);
}
