import type { ReactNode } from "react";
import { MdBolt } from "react-icons/md";

// Full-screen brand backdrop for /login and /login/verify. Renders the
// gradient field, four bloom orbs, and the Tokenizer wordmark above the
// children slot. Pure presentation; server-component compatible.
//
// Four orbs (vs. two on the home page banner) because the canvas is the
// whole viewport and two would leave large dead zones.
export function LoginShell({
  tagline,
  children,
}: {
  tagline: string;
  children: ReactNode;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-brand-500/15 via-white to-brand-500/5 dark:from-brand-500/20 dark:via-navy-900 dark:to-brand-500/10">
      <div className="pointer-events-none absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-brand-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 -bottom-32 h-[26rem] w-[26rem] rounded-full bg-brand-500/15 blur-3xl" />
      <div className="pointer-events-none absolute right-1/4 -top-24 h-72 w-72 rounded-full bg-brand-300/20 blur-3xl" />
      <div className="pointer-events-none absolute left-1/4 -bottom-24 h-64 w-64 rounded-full bg-brand-300/15 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 py-12">
        <div className="mb-3 flex items-center gap-2.5">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-500 text-white shadow-lg shadow-brand-500/30">
            <MdBolt className="h-6 w-6" />
          </span>
          <span className="font-poppins text-2xl font-bold tracking-tight text-navy-700 dark:text-white">
            Tokenizer
          </span>
        </div>
        <p className="mb-8 text-center text-sm text-gray-600 dark:text-gray-400">{tagline}</p>

        {children}
      </div>
    </div>
  );
}
