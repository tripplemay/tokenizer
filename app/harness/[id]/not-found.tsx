import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MdArrowBack } from "react-icons/md";

export default async function HarnessProjectNotFound() {
  const t = await getTranslations("harness.detail");
  return (
    <div className="mt-3 space-y-4">
      <Link
        href="/harness"
        className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <MdArrowBack className="h-4 w-4" />
        {t("back")}
      </Link>
      <section className="border-y border-gray-200 py-6 dark:border-white/10">
        <h1 className="text-xl font-bold text-navy-700 dark:text-white">{t("notFoundTitle")}</h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t("notFoundBody")}</p>
      </section>
    </div>
  );
}
