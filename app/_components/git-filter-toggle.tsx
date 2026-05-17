import Link from "next/link";
import type { ProjectFilter } from "@/server/summaries";

export function GitFilterToggle({
  current,
  searchParams,
  labels
}: {
  current: ProjectFilter;
  searchParams: Record<string, string | string[] | undefined>;
  labels: { all: string; gitOnly: string };
}) {
  const buildHref = (next: ProjectFilter): string => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (key === "gitOnly" || value === undefined) continue;
      const v = Array.isArray(value) ? value[0] : value;
      if (v != null) params.set(key, v);
    }
    if (next === "gitOnly") params.set("gitOnly", "1");
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  };

  const options: Array<{ value: ProjectFilter; label: string }> = [
    { value: "all", label: labels.all },
    { value: "gitOnly", label: labels.gitOnly }
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
