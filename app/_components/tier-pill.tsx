const colorByTier: Record<string, string> = {
  priority: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300",
  batch:    "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300",
};

// Renders a colored pill next to a model name when service_tier is non-default.
// "standard" returns null because it's the default tier — showing it on every
// row would be visual noise (67k of our 187k events are non-Claude and won't
// have a tier at all; we don't want a wasted column header for them either).
export function TierPill({ tier }: { tier: string | null | undefined }) {
  if (!tier || tier === "standard") return null;
  const color = colorByTier[tier] ?? "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {tier}
    </span>
  );
}
