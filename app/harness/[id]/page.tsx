import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MdArrowBack, MdHistory, MdSettingsSuggest, MdSpaceDashboard, MdTimeline } from "react-icons/md";
import { prisma } from "@/server/db";
import { requireSession } from "@/server/auth-session";
import { ownedHarnessProjectDetailQuery } from "@/server/harness-detail";
import { signingKeyReady } from "@/server/harness-sign";
import { getUserTimezone } from "@/server/timezone";
import { AutoRefresh } from "../../_components/auto-refresh";
import { modeDrilldownTarget } from "./mode-drilldown";
import { ActivityView, ModesAndAgentsView, OverviewView, TimelineView } from "./views";

export const dynamic = "force-dynamic";

const VIEWS = ["overview", "timeline", "modes", "activity"] as const;
type DetailView = (typeof VIEWS)[number];

function selectedView(value: string | string[] | undefined): DetailView {
  const candidate = Array.isArray(value) ? value[0] : value;
  return VIEWS.find((view) => view === candidate) ?? "overview";
}

export default async function HarnessProjectDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query, session] = await Promise.all([params, searchParams, requireSession()]);
  const userId = session.user.id;
  const [project, t, timezone] = await Promise.all([
    prisma.harnessProject.findFirst(ownedHarnessProjectDetailQuery(id, userId)),
    getTranslations("harness.detail"),
    getUserTimezone(userId)
  ]);
  if (!project) notFound();

  const view = selectedView(query.view);
  const selectedFocus = modeDrilldownTarget(query.focus);
  const icons = {
    overview: MdSpaceDashboard,
    timeline: MdTimeline,
    modes: MdSettingsSuggest,
    activity: MdHistory
  };

  return (
    <div className="mt-3 min-w-0 space-y-5">
      <AutoRefresh intervalMs={30000} />
      <header className="min-w-0 border-b border-gray-200 pb-4 dark:border-white/10">
        <Link
          href="/harness"
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <MdArrowBack className="h-4 w-4" />
          {t("back")}
        </Link>
        <div className="mt-2 flex min-w-0 flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-bold text-navy-700 dark:text-white">{project.name}</h1>
            <p className="mt-1 break-all font-mono text-xs text-gray-500 dark:text-gray-400">{project.repoKey}</p>
          </div>
          <p className="font-mono text-xs text-gray-400">{project.batch ?? t("notReported")}</p>
        </div>
      </header>

      <nav aria-label={t("tabsLabel")} className="max-w-full overflow-x-auto border-b border-gray-200 dark:border-white/10">
        <div className="flex min-w-max gap-1" role="tablist">
          {VIEWS.map((item) => {
            const Icon = icons[item];
            const active = view === item;
            return (
              <Link
                key={item}
                href={`/harness/${encodeURIComponent(project.id)}?view=${item}`}
                role="tab"
                aria-selected={active}
                className={`inline-flex h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                  active
                    ? "border-brand-500 text-brand-600 dark:text-brand-300"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-navy-700 dark:text-gray-400 dark:hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t(`tabs.${item}`)}
              </Link>
            );
          })}
        </div>
      </nav>

      {view === "overview" ? <OverviewView project={project} timezone={timezone} /> : null}
      {view === "timeline" ? <TimelineView project={project} timezone={timezone} /> : null}
      {view === "modes" ? (
        <ModesAndAgentsView
          project={project}
          canSign={signingKeyReady()}
          timezone={timezone}
          selectedFocus={selectedFocus}
        />
      ) : null}
      {view === "activity" ? <ActivityView project={project} timezone={timezone} /> : null}
    </div>
  );
}
