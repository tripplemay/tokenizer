import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/server/db";
import Card from "@/components/card";
import { SourcePill } from "../_components/source-pill";
import { PageBanner } from "../_components/page-banner";
import { formatDateTimeSeconds } from "@/shared/format";
import { requireSession } from "@/server/auth-session";

export const dynamic = "force-dynamic";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export default async function EventsPage() {
  const session = await requireSession();
  const tenantId = session.user.id;
  const [t, events] = await Promise.all([
    getTranslations(),
    prisma.usageEvent.findMany({
      where: { userId: tenantId },
      take: 200,
      orderBy: { occurredAt: "desc" },
      include: { project: true, device: true }
    })
  ]);

  return (
    <div className="space-y-5">
      <PageBanner
        title={t("events.title")}
        subtitle={<p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t("events.subtitle", { count: events.length })}</p>}
        note={<p className="mt-0.5 text-xs text-gray-500">{t("timezone.note")}</p>}
      />
      <Card extra="p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-gray-500">
              <tr>
                <th className="pb-3 pr-4">{t("events.col.time")}</th>
                <th className="pb-3 pr-4">{t("events.col.device")}</th>
                <th className="pb-3 pr-4">{t("events.col.project")}</th>
                <th className="pb-3 pr-4">{t("events.col.source")}</th>
                <th className="pb-3 pr-4">{t("events.col.model")}</th>
                <th className="pb-3 pr-4 text-right">{t("events.col.totalRaw")}</th>
                <th className="pb-3 pr-4 text-right">{t("events.col.input")}</th>
                <th className="pb-3 pr-4 text-right">{t("events.col.output")}</th>
                <th className="pb-3 pr-4 text-right">{t("events.col.cacheWrite")}</th>
                <th className="pb-3 pr-4 text-right">{t("events.col.cacheRead")}</th>
                <th className="pb-3 text-right">{t("events.col.reasoning")}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-t border-gray-200 text-navy-700 dark:border-white/10 dark:text-white">
                  <td className="py-2.5 pr-4 whitespace-nowrap text-gray-500 dark:text-gray-400">{formatDateTimeSeconds(event.occurredAt)}</td>
                  <td className="py-2.5 pr-4 whitespace-nowrap text-gray-600 dark:text-gray-300">
                    {event.device ? (
                      <Link href={`/devices/${event.deviceId}`} className="hover:underline">{event.device.name}</Link>
                    ) : (
                      <span className="text-gray-400">{t("events.unknownDevice")}</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 font-medium">{event.project?.name ?? t("events.unknownProject")}</td>
                  <td className="py-2.5 pr-4"><SourcePill source={event.source} /></td>
                  <td className="py-2.5 pr-4 text-gray-600 dark:text-gray-300">{event.model ?? t("events.unknownModel")}</td>
                  <td className="py-2.5 pr-4 text-right">{formatNumber(event.totalTokens)}</td>
                  <td className="py-2.5 pr-4 text-right">{formatNumber(event.inputTokens)}</td>
                  <td className="py-2.5 pr-4 text-right">{formatNumber(event.outputTokens)}</td>
                  <td className="py-2.5 pr-4 text-right">{formatNumber(event.cacheWriteTokens)}</td>
                  <td className="py-2.5 pr-4 text-right">{formatNumber(event.cachedInputTokens)}</td>
                  <td className="py-2.5 text-right">{formatNumber(event.reasoningOutputTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
