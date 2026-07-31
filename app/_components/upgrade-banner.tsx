import { MdWarningAmber } from "react-icons/md";
import { getTranslations } from "next-intl/server";
import { CopyInstallCommand, type InstallCommandOption } from "./copy-install-command";

// Server-component banner. Rendered by AdminShell when at least one device
// either needs an upgrade or still needs version verification.
// The interactive copy logic lives in <CopyInstallCommand>, which is
// itself a client component — that's the only piece that needs to be
// client-side. The banner shell stays server-rendered for fast first
// paint.
export function shouldRenderUpgradeBanner(outdatedCount: number, unknownCount: number): boolean {
  return outdatedCount > 0 || unknownCount > 0;
}

export async function UpgradeBanner({
  outdatedCount,
  unknownCount,
  latestRelease,
  highlights,
  commands,
}: {
  outdatedCount: number;
  unknownCount: number;
  latestRelease: string;
  highlights: readonly string[];
  commands: InstallCommandOption[];
}) {
  const t = await getTranslations();
  const needsUpgrade = outdatedCount > 0;
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
      <div className="flex items-start gap-3">
        <MdWarningAmber className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          {needsUpgrade ? (
            <>
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                {t("upgradeBanner.message", { count: outdatedCount, version: latestRelease })}
              </p>
              <div className="mt-1 text-sm text-amber-800 dark:text-amber-100">
                <span className="font-medium">{t("upgradeBanner.latest", { version: latestRelease })}</span>
                {highlights.length > 0 ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
                  </ul>
                ) : null}
              </div>
              {unknownCount > 0 ? (
                <p className="mt-1 text-xs text-amber-800 dark:text-amber-100">
                  {t("upgradeBanner.unknown", { count: unknownCount })}
                </p>
              ) : null}
              <div className="mt-2">
                <CopyInstallCommand commands={commands} variant="banner" />
              </div>
            </>
          ) : (
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              {t("upgradeBanner.unknownOnly", { count: unknownCount })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
