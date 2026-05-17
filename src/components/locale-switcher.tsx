"use client";

import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";

export function LocaleSwitcher() {
  const router = useRouter();
  const locale = useLocale();
  const target = locale === "zh-CN" ? "en" : "zh-CN";
  const label = locale === "zh-CN" ? "EN" : "中";

  function switchLocale() {
    // 1y cookie so the choice persists across visits. SameSite=Lax keeps it
    // working inside the same-origin Server Component refetch.
    document.cookie = `NEXT_LOCALE=${target}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={switchLocale}
      aria-label={`Switch language to ${target}`}
      className="cursor-pointer rounded-full px-2 py-1 text-xs font-bold text-gray-600 hover:text-brand-500 dark:text-white"
    >
      {label}
    </button>
  );
}
