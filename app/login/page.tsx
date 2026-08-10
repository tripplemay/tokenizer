import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth, signIn } from "@/auth";
import { safeCallbackPath } from "@/shared/url";
import { LoginShell } from "../_components/login-shell";
import { LoginSubmitButton } from "../_components/login-submit-button";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; callbackUrl?: string }> }) {
  const params = await searchParams;
  const session = await auth();
  const callbackPath = safeCallbackPath(params.callbackUrl);
  if (session?.user) redirect(callbackPath);
  const t = await getTranslations();

  // Server action — when AUTH_RESEND_KEY isn't configured, the "resend"
  // provider isn't registered, signIn() throws, and we redirect back here
  // with ?error=Configuration so the user sees a useful message.
  async function loginAction(formData: FormData) {
    "use server";
    const email = formData.get("email");
    if (typeof email !== "string" || !email) return;
    await signIn("resend", { email, redirectTo: "/" });
  }

  return (
    <LoginShell tagline={t("login.tagline")}>
      <div className="w-full rounded-2xl border border-white/40 bg-white/70 p-8 shadow-xl shadow-brand-500/5 backdrop-blur-xl dark:border-white/10 dark:bg-navy-800/70">
        <h1 className="text-2xl font-bold text-navy-700 dark:text-white">{t("login.title")}</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{t("login.description")}</p>

        {params.error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50/80 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {params.error === "Configuration"
              ? t("login.error.configuration")
              : t("login.error.generic", { code: params.error })}
          </div>
        ) : null}

        <form action={loginAction} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t("login.field.email")}
            </label>
            <input
              id="email"
              type="email"
              name="email"
              required
              autoComplete="email"
              className="mt-1 block w-full rounded-xl border border-gray-300 bg-white/80 px-3 py-2 text-sm text-navy-700 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-white/10 dark:bg-navy-900/60 dark:text-white"
              placeholder="you@example.com"
            />
          </div>
          <LoginSubmitButton idleLabel={t("login.submit.idle")} pendingLabel={t("login.submit.pending")} />
        </form>

        <p className="mt-6 text-center text-xs text-gray-500 dark:text-gray-400">
          {t("login.firstUseHint")}
        </p>
      </div>
    </LoginShell>
  );
}
