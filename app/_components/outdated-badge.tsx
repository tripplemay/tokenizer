"use client";

import { MdHelpOutline, MdInfoOutline, MdUpdate } from "react-icons/md";
import { useTranslations } from "next-intl";

export type AgentReleaseBadgeStatus = {
  kind: "upgrade-required" | "unknown" | "ahead";
  reported: string | null;
  latest: string;
};

// Pure-presentational. The server determines the release state, allowing the
// browser to distinguish a known stale release from an unverified or newer
// client without trying to compare versions independently.
export function AgentReleaseBadge({ status }: { status: AgentReleaseBadgeStatus }) {
  const t = useTranslations();
  const content = status.kind === "upgrade-required"
    ? t("devices.agentReleaseBadge.upgrade", { current: status.reported ?? "?", latest: status.latest })
    : status.kind === "ahead"
      ? t("devices.agentReleaseBadge.ahead", { current: status.reported ?? "?" })
      : t("devices.agentReleaseBadge.unknown");
  const title = status.kind === "upgrade-required"
    ? `agent v${status.reported ?? "?"} -> v${status.latest}`
    : status.kind === "ahead"
      ? `agent v${status.reported ?? "?"}; server latest v${status.latest}`
      : `agent release unavailable; server latest v${status.latest}`;
  const style = status.kind === "upgrade-required"
    ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
    : status.kind === "ahead"
      ? "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
      : "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300";
  const Icon = status.kind === "upgrade-required" ? MdUpdate : status.kind === "ahead" ? MdInfoOutline : MdHelpOutline;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${style}`}
      title={title}
    >
      <Icon className="h-3 w-3" />
      {content}
    </span>
  );
}
