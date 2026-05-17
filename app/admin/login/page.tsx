import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Card from "@/components/card";
import { isAdminAuthorizedFromCookie } from "@/server/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  if (await isAdminAuthorizedFromCookie()) {
    redirect("/admin/setup");
  }
  const t = await getTranslations();
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card extra="w-full max-w-sm p-8">
        <h2 className="mb-2 text-xl font-bold text-navy-700 dark:text-white">{t("admin.login.title")}</h2>
        <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">{t("admin.login.subtitle")}</p>
        <LoginForm />
      </Card>
    </div>
  );
}
