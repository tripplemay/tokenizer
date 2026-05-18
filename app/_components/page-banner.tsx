import type { ReactNode } from "react";

// Shared header banner used across dashboard pages. Mirrors the visual
// pattern that's been on the home page — a gradient-bordered card with
// two decorative blur orbs — so every page's first row stands clearly
// apart from the translucent sticky navbar above it.
//
// Pure-presentation. No state, no client hooks → safe to render from
// server components.
export function PageBanner({
  title,
  subtitle,
  note,
  overline,
  rightSlot,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  note?: ReactNode;
  overline?: ReactNode;
  rightSlot?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-gray-200 bg-gradient-to-br from-brand-500/10 via-white to-brand-500/5 px-6 py-5 dark:border-white/10 dark:from-brand-500/15 dark:via-navy-800 dark:to-brand-500/5">
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -left-12 h-48 w-48 rounded-full bg-brand-500/10 blur-3xl" />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div>
          {overline}
          <h2 className="text-2xl font-bold text-navy-700 dark:text-white">{title}</h2>
          {subtitle}
          {note}
        </div>
        {rightSlot}
      </div>
    </div>
  );
}
