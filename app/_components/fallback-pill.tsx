// Amber pill flagging a mid-request model fallback next to a model name.
// The caller passes the already-translated label ("from claude-fable-5" /
// "降级至 claude-opus-4-8") so this stays a plain presentational component,
// mirroring TierPill.
export function FallbackPill({ label, title }: { label: string; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
    >
      {label}
    </span>
  );
}
