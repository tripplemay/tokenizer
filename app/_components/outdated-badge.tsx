"use client";

import { MdUpdate } from "react-icons/md";
import { useTranslations } from "next-intl";

// Pure-presentational badge. Caller is responsible for gating with
// isDeviceOutdated(); this component does NOT re-check, so passing a
// matching SHA would still render the badge. That keeps the component
// free of server-side imports and let it stay a thin client component.
export function OutdatedBadge({ agentVersion }: { agentVersion: string | null }) {
  const t = useTranslations();
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
      title={`agent ${agentVersion ?? "unknown"}`}
    >
      <MdUpdate className="h-3 w-3" />
      {t("devices.outdatedBadge")}
    </span>
  );
}
