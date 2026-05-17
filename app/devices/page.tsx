import { MdComputer } from "react-icons/md";
import Card from "@/components/card";
import { getDeviceSummary } from "@/server/summaries";
import { formatDateTime, formatFullNumber, formatTokens } from "@/shared/format";

export const dynamic = "force-dynamic";

function deviceStatus(lastSeenAt: string | null) {
  if (!lastSeenAt) return { label: "Never seen", color: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300" };
  const ageMs = Date.now() - new Date(lastSeenAt).getTime();
  if (ageMs < 2 * 60 * 1000) return { label: "Online", color: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300" };
  if (ageMs < 30 * 60 * 1000) return { label: "Stale", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300" };
  return { label: "Offline", color: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300" };
}

export default async function DevicesPage() {
  const devices = await getDeviceSummary();

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-navy-700 dark:text-white">Devices</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">All registered devices and the token activity they have contributed.</p>
      </div>

      <Card extra="p-6">
        <div className="mb-4 flex items-center gap-2">
          <MdComputer className="h-5 w-5 text-brand-500" />
          <h3 className="text-lg font-bold text-navy-700 dark:text-white">{devices.length} device{devices.length === 1 ? "" : "s"}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-gray-500">
              <tr>
                <th className="pb-3">Name</th>
                <th className="pb-3">Status</th>
                <th className="pb-3">Hostname</th>
                <th className="pb-3">Platform</th>
                <th className="pb-3">Last seen</th>
                <th className="pb-3">Last sync</th>
                <th className="pb-3">Last event</th>
                <th className="pb-3 text-right">Tokens</th>
                <th className="pb-3 text-right">Events</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => {
                const { label, color } = deviceStatus(device.lastSeenAt);
                return (
                  <tr key={device.deviceId} className="border-t border-gray-200 text-navy-700 dark:border-white/10 dark:text-white">
                    <td className="py-2.5 pr-4 font-medium">{device.name}</td>
                    <td className="py-2.5 pr-4">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{label}</span>
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
