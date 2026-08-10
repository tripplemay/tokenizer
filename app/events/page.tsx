import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/server/db";
import Card from "@/components/card";
import { SourcePill } from "../_components/source-pill";
import { ModelLink } from "../_components/model-link";
import { TierPill } from "../_components/tier-pill";
import { FallbackPill } from "../_components/fallback-pill";
import { PageBanner } from "../_components/page-banner";
import { formatDateTimeSeconds } from "@/shared/format";
import { requireSession } from "@/server/auth-session";
import { getUserTimezone } from "@/server/timezone";
import {
  EVENTS_PAGE_SIZE,
  decodeEventsCursor,
  encodeEventsCursor,
  eventsCursorWhere
} from "@/server/events-cursor";

export const dynamic = "force-dynamic";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export default async function EventsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const cursorParam = typeof params.cursor === "string" ? params.cursor : undefined;
  const cursor = decodeEventsCursor(cursorParam);
  const session = await requireSession();
  const tenantId = session.user.id;
  const tz = await getUserTimezone(tenantId);
  const [t, page] = await Promise.all([
    getTranslations(),
    prisma.usageEvent.findMany({
      where: { userId: tenantId, ...(cursor ? eventsCursorWhere(cursor) : {}) },
      // 多取 1 条探测是否还有更旧页；同毫秒簇内以 id 双键排序保证游标稳定
      take: EVENTS_PAGE_SIZE + 1,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      include: { project: true, device: true }
    })
  ]);
  const hasOlder = page.length > EVENTS_PAGE_SIZE;
  const events = hasOlder ? page.slice(0, EVENTS_PAGE_SIZE) : page;
  const last = events.at(-1);
  const olderHref = hasOlder && last
    ? `/events?cursor=${encodeURIComponent(encodeEventsCursor({ occurredAt: last.occurredAt, id: last.id }))}`
    : null;

  return (
    <div className="space-y-5">
      <PageBanner
        title={t("events.title")}
        subtitle={<p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t("events.subtitle", { count: events.length })}</p>}
        note={<p className="mt-0.5 text-xs text-gray-500">{t("timezone.note", { tz })}</p>}
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
                  <td className="py-2.5 pr-4 whitespace-nowrap text-gray-500 dark:text-gray-400">{formatDateTimeSeconds(event.occurredAt, tz)}</td>
                  <td className="py-2.5 pr-4 whitespace-nowrap text-gray-600 dark:text-gray-300">
                    {event.device ? (
                      <Link href={`/devices/${event.deviceId}`} className="hover:underline">{event.device.name}</Link>
                    ) : (
                      <span className="text-gray-400">{t("events.unknownDevice")}</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 font-medium">{event.project?.name ?? t("events.unknownProject")}</td>
                  <td className="py-2.5 pr-4"><SourcePill source={event.source} /></td>
                  <td className="py-2.5 pr-4 text-gray-600 dark:text-gray-300">
                    <span className="inline-flex items-center gap-1.5">
                      <ModelLink model={event.model} fallback={t("events.unknownModel")} />
                      <TierPill tier={event.serviceTier} />
                      {event.fallbackFromModel ? (
                        <FallbackPill
                          label={t("events.fallbackFrom", { model: event.fallbackFromModel })}
                          title={t("events.fallbackFromTitle", { model: event.fallbackFromModel })}
                        />
                      ) : null}
                      {event.fallbackToModel ? (
                        <FallbackPill
                          label={t("events.fallbackTo", { model: event.fallbackToModel })}
                          title={t("events.fallbackToTitle", { model: event.fallbackToModel })}
                        />
                      ) : null}
                    </span>
                  </td>
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
        {(olderHref || cursor) && (
          <div className="mt-4 flex items-center justify-between border-t border-gray-200 pt-4 text-sm dark:border-white/10">
            {cursor ? (
              <Link href="/events" className="font-medium text-brand-500 hover:underline">
                {t("events.pagination.latest")}
              </Link>
            ) : (
              <span />
            )}
            {olderHref ? (
              <Link href={olderHref} className="font-medium text-brand-500 hover:underline">
                {t("events.pagination.older")}
              </Link>
            ) : (
              <span className="text-gray-400">{t("events.pagination.end")}</span>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
