import React from "react";
import { harnessHealthBadge, type HarnessHealthKey } from "@/shared/harness-health";

export type HarnessHealthLabels = Record<HarnessHealthKey, string>;

export function HarnessHealthBadge({
  status,
  attemptedAt,
  nowMs,
  labels
}: {
  status: string | null | undefined;
  attemptedAt: Date | string | null | undefined;
  nowMs: number;
  labels: HarnessHealthLabels;
}) {
  const { key, color } = harnessHealthBadge(status, attemptedAt, nowMs);
  return (
    <span
      data-harness-health={key}
      className={`inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}
    >
      <span className="truncate">{labels[key]}</span>
    </span>
  );
}
