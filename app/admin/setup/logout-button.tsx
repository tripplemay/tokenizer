"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export function LogoutButton() {
  const router = useRouter();
  const t = useTranslations("admin.setup");
  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  }
  return (
    <button
      onClick={logout}
      className="text-sm font-medium text-gray-600 hover:text-brand-500 dark:text-gray-300"
    >
      {t("logout")}
    </button>
  );
}
