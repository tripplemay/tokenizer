"use client";

import { useEffect, useState } from "react";

// Mounts → starts a countdown from `seconds` → renders a muted waiting
// message → at 0 swaps to a clickable resend link pointing back to
// /login (where the user re-enters their email). Resets on every mount
// (page refresh restarts the timer — intentional, no persistence).
//
// `waitingLabel` must contain the literal "{seconds}" placeholder.
export function LoginResendCountdown({
  seconds,
  waitingLabel,
  readyLabel,
}: {
  seconds: number;
  waitingLabel: string;
  readyLabel: string;
}) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(id);
  }, [remaining]);

  if (remaining > 0) {
    return (
      <span className="text-gray-400 dark:text-gray-500">
        {waitingLabel.replace("{seconds}", String(remaining))}
      </span>
    );
  }
  return (
    <a className="font-medium text-brand-500 hover:underline" href="/login">
      {readyLabel}
    </a>
  );
}
