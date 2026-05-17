"use client";

import { useEffect, useRef, useState } from "react";
import { formatTokens, formatUsd } from "@/shared/format";

type FormatKind = "tokens" | "usd" | "percent";

function formatValue(n: number, kind: FormatKind): string {
  if (kind === "tokens") return formatTokens(Math.round(n));
  if (kind === "usd") return formatUsd(n);
  return `${n.toFixed(1)}%`;
}

// Counts from previous → value when the prop changes (and from 0 on first
// mount) with cubic-out easing over ~700ms. Server components pass a
// `kind` string instead of a formatter function because functions aren't
// serialisable across the server/client boundary. Skips animation when
// the user prefers reduced motion.
export function AnimatedNumber({
  value,
  kind,
  durationMs = 700
}: {
  value: number;
  kind: FormatKind;
  durationMs?: number;
}) {
  const [shown, setShown] = useState(0);
  const previousValueRef = useRef<number | null>(null);

  useEffect(() => {
    const prev = previousValueRef.current;
    previousValueRef.current = value;
    if (typeof window === "undefined") {
      setShown(value);
      return;
    }
    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      setShown(value);
      return;
    }
    const startValue = prev ?? 0;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setShown(startValue + (value - startValue) * eased);
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return <>{formatValue(shown, kind)}</>;
}
