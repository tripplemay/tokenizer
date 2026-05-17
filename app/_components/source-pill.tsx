const colorByName: Record<string, string> = {
  "claude-code": "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300",
  codex: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  opencode: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300"
};

const fallback = "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300";

export function SourcePill({ source }: { source: string }) {
  const color = colorByName[source] ?? fallback;
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{source}</span>;
}
