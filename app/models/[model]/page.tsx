import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MdArrowBack, MdBolt, MdCached, MdInput, MdMemory, MdOutput, MdPaid, MdReceiptLong, MdSave, MdSpeed } from "react-icons/md";
import Card from "@/components/card";
import Widget from "@/components/widget/Widget";
import { getDailyForModel, getModelDetail } from "@/server/summaries";
import { requireSession } from "@/server/auth-session";
import { getUserTimezone } from "@/server/timezone";
import { utcToWallClock, wallClockToUtc } from "@/server/time-buckets";
import { formatDateTimeSeconds, formatFullNumber, formatPercent, formatTokens, formatUsd } from "@/shared/format";
import { DailyUsageChart } from "../../daily-usage-chart";
import { SourcePill } from "../../_components/source-pill";
import { ProjectIcon } from "../../_components/project-icon";
import { PageBanner } from "../../_components/page-banner";
import { ModelRangePicker } from "./model-range-picker";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

// Best-effort vendor label from the model id prefix, for the title badge.
function vendorOf(model: string): string | null {
  const m = model.toLowerCase();
  if (m.startsWith("claude") || m.startsWith("fable")) return "Anthropic";
  if (m.startsWith("gpt") || m.includes("codex")) return "OpenAI";
  if (m.startsWith("gemini")) return "Google";
  if (m.startsWith("deepseek")) return "DeepSeek";
  if (m.startsWith("glm")) return "Zhipu";
  if (m.startsWith("kimi") || m.startsWith("moonshot")) return "Moonshot";
  if (m.startsWith("minimax")) return "MiniMax";
  if (m.startsWith("mimo")) return "Xiaomi";
  return null;
}

export default async function ModelDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ model: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { model: rawModel } = await params;
  const model = decodeURIComponent(rawModel);
  const sp = await searchParams;
  const session = await requireSession();
  const tenantId = session.user.id;
  const tz = await getUserTimezone(tenantId);

  // [from, to) carry the user's local wall clock (the datetime-local value).
  // Default window is the last 7 days; the server interprets the wall clock in
  // the user's configured tz.
  const now = new Date();
  const toRaw = typeof sp.to === "string" && sp.to ? sp.to : utcToWallClock(now, tz);
  const fromRaw = typeof sp.from === "string" && sp.from ? sp.from : utcToWallClock(new Date(now.getTime() - 7 * DAY_MS), tz);
  let fromMs = wallClockToUtc(fromRaw, tz).getTime();
  let toMs = wallClockToUtc(toRaw, tz).getTime();
  // Fall back to the last 7 days on invalid or inverted input.
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    toMs = now.getTime();
    fromMs = toMs - 7 * DAY_MS;
  }
  const pickerFrom = utcToWallClock(new Date(fromMs), tz);
  const pickerTo = utcToWallClock(new Date(toMs), tz);

  const [t, detail, daily] = await Promise.all([
    getTranslations(),
    getModelDetail(tenantId, model, fromMs, toMs),
    getDailyForModel(tenantId, model, fromMs, toMs, tz),
  ]);

  const { totals, byProject, byDevice, bySource, events, price, costBreakdown, fallback } = detail;
  const fallbackRows = [
    ...fallback.out.map((row) => ({ ...row, direction: "out" as const })),
    ...fallback.in.map((row) => ({ ...row, direction: "in" as const }))
  ];
  const vendor = vendorOf(model);
  const isFree = price != null && price.input === 0 && price.output === 0;

  const banner = (
    <PageBanner
      overline={
        <Link href="/" className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:underline">
          <MdArrowBack className="h-4 w-4" />
          {t("modelDetail.back")}
        </Link>
      }
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          <MdMemory className="h-6 w-6 text-brand-500" />
          <span className="font-mono">{model}</span>
          {vendor ? (
            <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-600 dark:bg-brand-500/20 dark:text-brand-300">{vendor}</span>
          ) : null}
          {price == null ? (
            <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300">{t("modelDetail.unpriced")}</span>
          ) : isFree ? (
            <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-500/20 dark:text-green-300">{t("modelDetail.free")}</span>
          ) : null}
        </span>
      }
      subtitle={
        <div className="mt-2 text-xs text-gray-500">
          {pickerFrom.replace("T", " ")} → {pickerTo.replace("T", " ")} · {t(`modelDetail.range.granularity.${daily.granularity}`)} · {tz}
        </div>
      }
      rightSlot={<ModelRangePicker model={model} from={pickerFrom} to={pickerTo} tz={tz} />}
    />
  );

  if (totals.eventCount === 0) {
    return (
      <div className="space-y-5">
        {banner}
        <Card extra="p-6">
          <p className="text-navy-700 dark:text-white">{t("modelDetail.notFound")}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {banner}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div title={t("home.hero.computeHint")}>
          <Widget icon={<MdBolt className="h-7 w-7" />} title={t("modelDetail.metric.compute")} subtitle={formatTokens(totals.billableTokens)} />
        </div>
        <div title={t("home.hero.costHint")}>
          <Widget icon={<MdPaid className="h-7 w-7" />} title={t("modelDetail.metric.cost")} subtitle={totals.cost > 0 ? formatUsd(totals.cost) : "—"} />
        </div>
        <Widget icon={<MdSpeed className="h-7 w-7" />} title={t("modelDetail.metric.cacheHit")} subtitle={`${(totals.cacheHitRate * 100).toFixed(1)}%`} />
        <Widget icon={<MdReceiptLong className="h-7 w-7" />} title={t("modelDetail.metric.events")} subtitle={formatFullNumber(totals.eventCount)} />
        <div title={t("home.kpi.inputHint")}>
          <Widget icon={<MdInput className="h-7 w-7" />} title={t("home.kpi.inputTokens")} subtitle={formatTokens(totals.inputTokens)} />
        </div>
        <div title={t("home.kpi.cacheWriteHint")}>
          <Widget icon={<MdSave className="h-7 w-7" />} title={t("home.kpi.cacheWrite")} subtitle={formatTokens(totals.cacheWriteTokens)} />
        </div>
        <div title={t("home.kpi.cacheReuseHint")}>
          <Widget icon={<MdCached className="h-7 w-7" />} title={t("home.kpi.cacheReuse")} subtitle={formatTokens(totals.cachedInputTokens)} />
        </div>
        <div title={t("home.kpi.outputHint", { reasoning: formatTokens(totals.reasoningOutputTokens) })}>
          <Widget icon={<MdOutput className="h-7 w-7" />} title={t("home.kpi.outputTokens")} subtitle={formatTokens(totals.outputTokens)} />
        </div>
      </div>

      <Card extra="p-6">
        <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">{t("modelDetail.pricing.title")}</h3>
        {price == null ? (
          <p className="text-sm text-gray-500">{t("modelDetail.unpricedHelper")}</p>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">{t("modelDetail.pricing.perMtok")}</div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                <dt className="text-gray-500">{t("modelDetail.pricing.input")}</dt>
                <dd className="text-right font-medium text-navy-700 dark:text-white">{formatUsd(price.input)}</dd>
                <dt className="text-gray-500">{t("modelDetail.pricing.cacheRead")}</dt>
                <dd className="text-right font-medium text-navy-700 dark:text-white">{formatUsd(price.cacheRead)}</dd>
                <dt className="text-gray-500">{t("modelDetail.pricing.cacheWrite")}</dt>
                <dd className="text-right font-medium text-navy-700 dark:text-white">{formatUsd(price.cacheWrite)}</dd>
                <dt className="text-gray-500">{t("modelDetail.pricing.output")}</dt>
                <dd className="text-right font-medium text-navy-700 dark:text-white">{formatUsd(price.output)}</dd>
              </dl>
            </div>
            {costBreakdown && costBreakdown.total > 0 ? (
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">{t("modelDetail.pricing.breakdownTitle")}</div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                  <dt className="text-gray-500">{t("modelDetail.pricing.freshInput")}</dt>
                  <dd className="text-right font-medium text-navy-700 dark:text-white">{formatUsd(costBreakdown.freshInput)}</dd>
                  <dt className="text-gray-500">{t("modelDetail.pricing.cacheRead")}</dt>
                  <dd className="text-right font-medium text-navy-700 dark:text-white">{formatUsd(costBreakdown.cacheRead)}</dd>
                  <dt className="text-gray-500">{t("modelDetail.pricing.cacheWrite")}</dt>
                  <dd className="text-right font-medium text-navy-700 dark:text-white">{formatUsd(costBreakdown.cacheWrite)}</dd>
                  <dt className="text-gray-500">{t("modelDetail.pricing.output")}</dt>
                  <dd className="text-right font-medium text-navy-700 dark:text-white">{formatUsd(costBreakdown.output)}</dd>
                  <dt className="border-t border-gray-200 pt-1.5 font-semibold text-navy-700 dark:border-white/10 dark:text-white">{t("modelDetail.pricing.total")}</dt>
                  <dd className="border-t border-gray-200 pt-1.5 text-right font-semibold text-navy-700 dark:border-white/10 dark:text-white">{formatUsd(costBreakdown.total)}</dd>
                </dl>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      {fallbackRows.length > 0 ? (
        <Card extra="p-6">
          <div className="mb-3">
            <h3 className="text-lg font-bold text-navy-700 dark:text-white">{t("modelDetail.fallback.title")}</h3>
            <p className="text-xs text-gray-600 dark:text-gray-400">{t("modelDetail.fallback.subtitle")}</p>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="text-gray-500">
              <tr>
                <th className="pb-3">{t("modelDetail.fallback.colDirection")}</th>
                <th className="pb-3">{t("modelDetail.fallback.colModel")}</th>
                <th className="pb-3 pr-4 text-right">{t("modelDetail.col.events")}</th>
                <th className="pb-3 pr-4 text-right">{t("modelDetail.col.output")}</th>
                <th className="pb-3 pr-4 text-right">{t("modelDetail.col.compute")}</th>
                <th className="pb-3 pr-4 text-right">{t("modelDetail.col.cost")}</th>
              </tr>
            </thead>
            <tbody>
              {fallbackRows.map((row) => (
                <tr key={`${row.direction}:${row.model}`} className="border-t border-gray-200 text-navy-700 dark:border-white/10 dark:text-white">
                  <td className="py-2.5 pr-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        row.direction === "out"
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
                          : "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300"
                      }`}
                    >
                      {t(`modelDetail.fallback.${row.direction}`)}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4">
                    <Link href={`/models/${encodeURIComponent(row.model)}`} className="font-mono font-medium hover:underline">
                      {row.model}
                    </Link>
                  </td>
                  <td className="pr-4 text-right">{formatFullNumber(row.events)}</td>
                  <td className="pr-4 text-right">{formatTokens(row.outputTokens)}</td>
                  <td className="pr-4 text-right">{formatTokens(row.billableTokens)}</td>
                  <td className="pr-4 text-right font-medium">{row.cost > 0 ? formatUsd(row.cost) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-gray-500">{t("modelDetail.fallback.note")}</p>
        </Card>
      ) : null}

      <Card extra="p-6">
        <div className="mb-3">
          <h3 className="text-lg font-bold text-navy-700 dark:text-white">{t("modelDetail.daily.title")}</h3>
          <p className="text-xs text-gray-600 dark:text-gray-400">{t("modelDetail.daily.subtitle", { granularity: t(`modelDetail.range.granularity.${daily.granularity}`), tz })}</p>
        </div>
        <div className="h-72">
          <DailyUsageChart data={daily.points} granularity={daily.granularity} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card extra="p-6">
          <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">{t("modelDetail.devices.title")}</h3>
          <table className="w-full text-left text-sm">
            <thead className="text-gray-500">
              <tr>
                <th className="pb-3">{t("modelDetail.col.device")}</th>
                <th className="pb-3 pr-4 text-right">{t("modelDetail.col.compute")}</th>
                <th className="pb-3 pr-4 text-right">{t("modelDetail.col.cost")}</th>
                <th className="pb-3 pr-4 text-right">{t("modelDetail.col.events")}</th>
              </tr>
            </thead>
            <tbody>
              {byDevice.map((row) => (
                <tr key={row.deviceId} className="border-t border-gray-200 text-navy-700 dark:border-white/10 dark:text-white">
                  <td className="py-2.5 pr-4">
                    <Link href={`/devices/${row.deviceId}`} className="font-medium hover:underline">{row.name}</Link>
                  </td>
                  <td className="pr-4 text-right">{formatTokens(row.billableTokens)}</td>
                  <td className="pr-4 text-right font-medium">{row.cost > 0 ? formatUsd(row.cost) : "—"}</td>
                  <td className="pr-4 text-right">{row.events}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card extra="p-6">
          <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">{t("modelDetail.projects.title")}</h3>
          <table className="w-full text-left text-sm">
            <thead className="text-gray-500">
              <tr>
                <th className="pb-3">{t("modelDetail.col.project")}</th>
                <th className="pb-3 pr-4 text-right">{t("modelDetail.col.compute")}</th>
                <th className="pb-3 pr-4 text-right">{t("modelDetail.col.cost")}</th>
                <th className="pb-3 pr-4 text-right">{t("modelDetail.col.events")}</th>
              </tr>
            </thead>
            <tbody>
              {byProject.map((row) => (
                <tr key={row.projectId ?? row.name} className="border-t border-gray-200 text-navy-700 dark:border-white/10 dark:text-white">
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-1.5">
                      <ProjectIcon repoKey={row.repoKey} workspacePath={row.workspacePath} folderTitle={t("project.localFolderTooltip")} />
                      <Link href={row.projectId ? `/projects/${row.projectId}` : "#"} className="font-medium hover:underline">{row.name}</Link>
                    </div>
                  </td>
                  <td className="pr-4 text-right">{formatTokens(row.billableTokens)}</td>
                  <td className="pr-4 text-right font-medium">{row.cost > 0 ? formatUsd(row.cost) : "—"}</td>
                  <td className="pr-4 text-right">{row.events}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card extra="p-6">
        <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">{t("modelDetail.sources.title")}</h3>
        <table className="w-full text-left text-sm">
          <thead className="text-gray-500">
            <tr>
              <th className="pb-3">{t("modelDetail.col.source")}</th>
              <th className="pb-3 pr-4 text-right">{t("modelDetail.col.compute")}</th>
              <th className="pb-3 pr-4 text-right">{t("modelDetail.col.cost")}</th>
              <th className="pb-3 pr-4 text-right">{t("modelDetail.col.events")}</th>
              <th className="pb-3 pr-4 text-right">{t("modelDetail.col.share")}</th>
            </tr>
          </thead>
          <tbody>
            {bySource.map((row) => (
              <tr key={row.source} className="border-t border-gray-200 text-navy-700 dark:border-white/10 dark:text-white">
                <td className="py-2.5 pr-4"><SourcePill source={row.source} /></td>
                <td className="pr-4 text-right">{formatTokens(row.billableTokens)}</td>
                <td className="pr-4 text-right font-medium">{row.cost > 0 ? formatUsd(row.cost) : "—"}</td>
                <td className="pr-4 text-right">{row.events}</td>
                <td className="pr-4 text-right">{formatPercent(row.billableTokens, totals.billableTokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card extra="p-6">
        <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">{t("modelDetail.recentEvents")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-gray-500">
              <tr>
                <th className="pb-3">{t("modelDetail.col.time")}</th>
                <th className="pb-3">{t("modelDetail.col.source")}</th>
                <th className="pb-3 pr-4 text-right">{t("modelDetail.col.input")}</th>
                <th className="pb-3 pr-4 text-right">{t("modelDetail.col.output")}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-t border-gray-200 text-navy-700 dark:border-white/10 dark:text-white">
                  <td className="py-2.5 pr-4 whitespace-nowrap text-gray-500">{formatDateTimeSeconds(event.occurredAt, tz)}</td>
                  <td className="py-2.5 pr-4"><SourcePill source={event.source} /></td>
                  <td className="py-2.5 pr-4 text-right">{formatFullNumber(event.inputTokens)}</td>
                  <td className="py-2.5 pr-4 text-right">{formatFullNumber(event.outputTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
