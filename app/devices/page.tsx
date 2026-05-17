import { getTranslations } from "next-intl/server";
import { MdComputer } from "react-icons/md";
import Card from "@/components/card";
import { getDeviceSummary } from "@/server/summaries";
import { formatDateTime, formatFullNumber, formatTokens } from "@/shared/format";

export const dynamic = "force-dynamic";

function deviceStatusKey(lastSeenAt: string | null) {
  if (!lastSeenAt) return { key: "neverSeen" as const, color: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300" };
  const ageMs = Date.now() - new Date(lastSeenAt).getTime();
  if (ageMs < 2 * 60 * 1000) return { key: "online" as const, color: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300" };
  if (ageMs < 30 * 60 * 1000) return { key: "stale" as const, color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300" };
  return { key: "offline" as const, color: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300" };
}

export default async function DevicesPage() {
  const [t, devices] = await Promise.all([getTranslations(), getDeviceSummary()]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-navy-700 dark:text-white">{t("devices.title")}</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t("devices.subtitle")}</p>
        <p className="mt-0.5 text-xs text-gray-500">{t("timezone.note")}</p>
      </div>

      <Card extra="p-6">
        <div className="mb-4 flex items-center gap-2">
          <MdComputer className="h-5 w-5 text-brand-500" />
          <h3 className="text-lg font-bold text-navy-700 dark:text-white">{t("devices.count", { count: devices.length })}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-gray-500">
              <tr>
                <th className="pb-3">{t("devices.col.name")}</th>
                <th className="pb-3">{t("devices.col.status")}</th>
                <th className="pb-3">{t("devices.col.hostname")}</th>
                <th className="pb-3">{t("devices.col.platform")}</th>
                <th className="pb-3">{t("devices.col.lastSeen")}</th>
                <th className="pb-3">{t("devices.col.lastSync")}</th>
                <th className="pb-3">{t("devices.col.lastEvent")}</th>
                <th className="pb-3 text-right">{t("devices.col.tokens")}</th>
                <th className="pb-3 text-right">{t("devices.col.events")}</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => {
                const { key, color } = deviceStatusKey(device.lastSeenAt);
                return (
                  <tr key={device.deviceId} className="border-t border-gray-200 text-navy-700 dark:border-white/10 dark:text-white">
                    <td className="py-2.5 pr-4 font-medium">{device.name}</td>
                    <td className="py-2.5 pr-4">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{t(`clientStatus.${key}`)}</span>
                    </td>
                    <td className="py-2.5 pr-4 text-gray-600 dark:text-gray-300">{device.hostname ?? "-"}</td>
                    <td className="py-2.5 pr-4 text-gray-600 dark:text-gray-300">{device.platform ?? "-"}</td>
                    <td className="py-2.5 pr-4 whitespace-nowrap text-gray-500">{formatDateTime(device.lastSeenAt)}</td>
                    <td className="py-2.5 pr-4 whitespace-nowrap text-gray-500">{formatDateTime(device.lastSyncAt)}</td>
                    <td className="py-2.5 pr-4 whitespace-nowrap text-gray-500">{formatDateTime(device.lastEventAt)}</td>
                    <td className="py-2.5 pr-4 text-right" title={`${formatFullNumber(device.billableTokens)} billable tokens`}>{formatTokens(device.billableTokens)}</td>
                    <td className="py-2.5 pr-4 text-right">{formatFullNumber(device.events)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
