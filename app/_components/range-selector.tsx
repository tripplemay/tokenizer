import Link from "next/link";
import type { RangeOption } from "@/server/summaries";

// Server-rendered pill selector. Each option toggles the `range` query param;
// "all" clears the param so a bare `/` URL stays clean and the choice is
// shareable. Reads existing search params off the page so other filters
// (e.g. `gitOnly`) are preserved across switches.
export function RangeSelector({
  current,
  searchParams,
  labels
}: {
  current: RangeOption;
  searchParams: Record<string, string | string[] | undefined>;
  labels: { sevenDay: string; thirtyDay: string; all: string };
}) {
  const buildHref = (next: RangeOption): string => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (key === "range" || value === undefined) continue;
      const v = Array.isArray(value) ? value[0] : value;
      if (v != null) params.set(key, v);
    }
    if (next !== "all") params.set("range", next);
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  };

  const options: Array<{ value: RangeOption; label: string }> = [
    { value: "7d", label: labels.sevenDay },
    { value: "30d", label: labels.thirtyDay },
    { value: "all", label: labels.all }
  ];

  return (
    <div className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 p-1 dark:bg-navy-800">
      {options.map((opt) => {
        const active = current === opt.value;
        return (
          <Link
            key={opt.value}
            href={buildHref(opt.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              active
                ? "bg-white text-navy-700 shadow-sm dark:bg-navy-700 dark:text-white"
                : "text-gray-600 hover:text-navy-700 dark:text-gray-400 dark:hover:text-white"
            }`}
          >
            {opt.label}
          </Link>
        );
      })}
    </div>
  );
}
