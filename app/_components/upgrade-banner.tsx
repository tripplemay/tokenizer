import { MdWarningAmber } from "react-icons/md";
import { getTranslations } from "next-intl/server";
import { CopyInstallCommand, type InstallCommandOption } from "./copy-install-command";

// Server-component banner. Rendered by AdminShell only when count > 0.
// The interactive copy logic lives in <CopyInstallCommand>, which is
// itself a client component — that's the only piece that needs to be
// client-side. The banner shell stays server-rendered for fast first
// paint.
export async function UpgradeBanner({
  count,
  commands,
}: {
  count: number;
  commands: InstallCommandOption[];
}) {
  const t = await getTranslations();
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
      <div className="flex items-start gap-3">
        <MdWarningAmber className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            {t("upgradeBanner.message", { count })}
          </p>
          <div className="mt-2">
            <CopyInstallCommand commands={commands} variant="banner" />
          </div>
        </div>
      </div>
    </div>
  );
}
