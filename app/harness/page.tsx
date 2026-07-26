import { getTranslations } from "next-intl/server";
import { MdGavel, MdAccountTree, MdWarning } from "react-icons/md";
import Card from "@/components/card";
import { prisma } from "@/server/db";
import { requireSession } from "@/server/auth-session";
import { getUserTimezone } from "@/server/timezone";
import { signingKeyReady } from "@/server/harness-sign";
import { formatRelativeTime } from "@/shared/format";
import { AutoRefresh } from "../_components/auto-refresh";
import { GateActions } from "./gate-actions";
import ModeBadges from "./mode-badges";

export const dynamic = "force-dynamic";

const PHASES = ["new", "planning", "building", "verifying", "fixing", "reverifying", "done"];

/**
 * harness 编排面板：项目进度 + 待批闸门。
 *
 * ⚠️ 本页是**只读镜像**——真相源是各机器仓库里的 progress.json / features.json。
 * 唯一的写操作是给闸门签发决策（GateActions），而那只是签发，不是推进：
 * 机器要等 device agent 取走、验签、写回本机才真正跨闸门。
 */
export default async function HarnessPage() {
  const session = await requireSession();
  const t = await getTranslations("harness");
  const tRelative = await getTranslations("relative");
  const userId = session.user!.id!;
  const tz = await getUserTimezone(userId);

  const [projects, gates] = await Promise.all([
    prisma.harnessProject.findMany({
      where: { userId },
      include: { device: { select: { name: true } } },
      orderBy: [{ reportedAt: "desc" }]
    }),
    prisma.harnessGate.findMany({
      where: { userId, consumedAt: null },
      include: { harnessProject: { select: { name: true, repoKey: true } } },
      orderBy: [{ decisionAt: "asc" }, { raisedAt: "asc" }]
    })
  ]);

  const canSign = signingKeyReady();
  const pending = gates.filter((g) => !g.decisionAction);
  const signed = gates.filter((g) => g.decisionAction);

  return (
    <div className="mt-3 flex flex-col gap-5">
      <AutoRefresh intervalMs={30000} />

      {!canSign ? (
        <Card extra="!p-4 border border-amber-300 dark:border-amber-500/40">
          <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
            <MdWarning className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{t("signingKeyMissing")}</span>
          </div>
        </Card>
      ) : null}

      {/* ── 待批闸门 ── */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-gray-600 dark:text-white">
          <MdGavel className="h-5 w-5" /> {t("pendingGates")}
          {pending.length > 0 ? (
            <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">{pending.length}</span>
          ) : null}
        </h2>

        {gates.length === 0 ? (
          <Card extra="!p-5">
            <p className="text-sm text-gray-600 dark:text-gray-300">{t("noGates")}</p>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {[...pending, ...signed].map((g) => (
              <Card key={g.id} extra="!p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-navy-700 dark:text-white">
                    {g.harnessProject.name}
                  </span>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                    {t(`kind.${g.kind}`)}
                  </span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-600 dark:bg-white/10 dark:text-gray-300">
                    {g.batch}
                  </span>
                  {g.fromStatus ? (
                    <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                      {g.fromStatus} → {g.toStatus ?? "—"}
                    </span>
                  ) : null}
                  <span className="ml-auto text-xs text-gray-400">
                    {formatRelativeTime(g.raisedAt, tRelative, tz)} · {g.raisedBy}
                  </span>
                </div>

                <p className="mt-2 text-sm text-gray-700 dark:text-gray-200">{g.detail}</p>
                <p className="mt-1 font-mono text-xs text-gray-400">{g.gateId}</p>

                {Array.isArray(g.evidence) && g.evidence.length > 0 ? (
                  <ul className="mt-2 list-inside list-disc font-mono text-xs text-gray-500 dark:text-gray-400">
                    {(g.evidence as string[]).map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                ) : null}

                {g.decisionAction ? (
                  <p className="mt-3 text-sm">
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-500/15 dark:text-green-300">
                      {t(g.decisionAction === "approve" ? "approved" : "rejected")}
                    </span>{" "}
                    <span className="text-gray-500 dark:text-gray-400">
                      {g.decisionBy} · {g.decisionAt ? formatRelativeTime(g.decisionAt, tRelative, tz) : ""}
                      {g.decisionNote ? ` · ${g.decisionNote}` : ""}
                    </span>
                    <br />
                    <span className="text-xs text-gray-400">
                      {g.relayedAt ? t("relayed") : t("awaitingRelay")}
                    </span>
                  </p>
                ) : (
                  <GateActions
                    id={g.id}
                    disabled={!canSign}
                    disabledReason={t("signingKeyMissing")}
                  />
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ── 项目进度 ── */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-gray-600 dark:text-white">
          <MdAccountTree className="h-5 w-5" /> {t("projects")}
        </h2>

        {projects.length === 0 ? (
          <Card extra="!p-5">
            <p className="text-sm text-gray-600 dark:text-gray-300">{t("noProjects")}</p>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => {
              const pct = p.totalCount > 0 ? Math.round((p.completedCount / p.totalCount) * 100) : 0;
              const idx = PHASES.indexOf(p.status ?? "");
              return (
                <Card key={p.id} extra="!p-5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-navy-700 dark:text-white">{p.name}</span>
                    <span className="ml-auto font-mono text-xs text-gray-400">{p.headSha}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {p.device.name} · {p.reportedAt ? formatRelativeTime(p.reportedAt, tRelative, tz) : "—"}
                  </p>

                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-gray-600 dark:bg-white/10 dark:text-gray-300">
                      {p.batch ?? "—"}
                    </span>
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                      {p.status ?? "—"}
                    </span>
                    {p.fixRounds > 0 ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                        fix ×{p.fixRounds}
                      </span>
                    ) : null}
                    {p.autonomyStatus ? (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-gray-600 dark:bg-white/10 dark:text-gray-300">
                        autodrive:{p.autonomyStatus}
                      </span>
                    ) : null}
                  </div>

                  <ModeBadges modes={p.modes} />

                  <div className="mt-3 flex flex-wrap gap-1">
                    {PHASES.map((s, i) => (
                      <span
                        key={s}
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                          s === p.status
                            ? "bg-brand-500 text-white"
                            : i < idx
                              ? "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300"
                              : "bg-gray-100 text-gray-400 dark:bg-white/5 dark:text-gray-500"
                        }`}
                      >
                        {s}
                      </span>
                    ))}
                  </div>

                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
                    <div className="h-full bg-brand-500" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {p.completedCount}/{p.totalCount} · {pct}%
                  </p>

                  {p.lastHaltCondition ? (
                    <p className="mt-2 text-xs text-red-500">
                      halt: {p.lastHaltCondition}
                      {p.lastHaltDetail ? ` — ${p.lastHaltDetail}` : ""}
                    </p>
                  ) : null}
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
