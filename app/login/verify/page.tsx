import { MdMarkEmailRead } from "react-icons/md";
import { getTranslations } from "next-intl/server";
import { LoginShell } from "../../_components/login-shell";
import { LoginResendCountdown } from "../../_components/login-resend-countdown";

export const dynamic = "force-dynamic";

export default async function VerifyPage() {
  const t = await getTranslations();
  return (
    <LoginShell tagline={t("login.tagline")}>
      <div className="w-full rounded-2xl border border-white/40 bg-white/70 p-8 text-center shadow-xl shadow-brand-500/5 backdrop-blur-xl dark:border-white/10 dark:bg-navy-800/70">
        {/* Animated email icon — outer ping ring + slower inner pulse +
            steady icon, reads as "actively waiting for email." */}
        <div className="relative mx-auto h-16 w-16">
          <span className="absolute inset-0 animate-ping rounded-full bg-brand-500/20" />
          <span className="absolute inset-0 animate-pulse rounded-full bg-brand-500/10" />
          <span className="relative inline-flex h-16 w-16 items-center justify-center rounded-full bg-brand-500/15 text-brand-500">
            <MdMarkEmailRead className="h-7 w-7" />
          </span>
        </div>

        <h1 className="mt-5 text-2xl font-bold text-navy-700 dark:text-white">{t("login.verify.title")}</h1>
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">{t("login.verify.description")}</p>

        <div className="mt-6 text-xs text-gray-500 dark:text-gray-400">
          {t("login.verify.noEmailHint")}
          <LoginResendCountdown
            seconds={60}
            waitingLabel={t("login.verify.resendWaiting")}
            readyLabel={t("login.verify.resendReady")}
          />
        </div>
      </div>
    </LoginShell>
  );
}
