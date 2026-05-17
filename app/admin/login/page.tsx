import { redirect } from "next/navigation";
import Card from "@/components/card";
import { isAdminAuthorizedFromCookie } from "@/server/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  if (await isAdminAuthorizedFromCookie()) {
    redirect("/admin/setup");
  }
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card extra="w-full max-w-sm p-8">
        <h2 className="mb-2 text-xl font-bold text-navy-700 dark:text-white">Admin Sign In</h2>
        <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">Enter the admin token to access admin pages. Token is set via the ADMIN_TOKEN env var on the server.</p>
        <LoginForm />
      </Card>
    </div>
  );
}
