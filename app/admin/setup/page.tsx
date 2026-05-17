import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Card from "@/components/card";
import { isAdminAuthorizedFromCookie } from "@/server/auth";
import { SetupForm } from "./setup-form";
import { LogoutButton } from "./logout-button";

export const dynamic = "force-dynamic";

export default async function AdminSetupPage() {
  if (!(await isAdminAuthorizedFromCookie())) {
    redirect("/admin/login");
  }
  const t = await getTranslations();
  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-navy-700 dark:text-white">{t("admin.setup.title")}</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t("admin.setup.subtitle")}</p>
        </div>
        <LogoutButton />
      </div>
      <Card extra="p-6">
        <SetupForm />
      </Card>
    </div>
  );
}
