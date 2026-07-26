import { getTranslations } from "next-intl/server";
import { frameworkStanding } from "@/shared/framework-version";

/**
 * 项目模式指纹的渲染（P1）。
 *
 * harness 有六个正交维度，每个维度的开关散在项目里不同的文件中。这个组件把 agent 上报的
 * 快照压成一行徽章 + 一段「不对劲的地方」，让人看一眼就知道这个项目现在跑在什么模式下。
 *
 * ⚠️ 只读镜像。徽章画错不影响机器上的任何守门——那些校验器在机器侧独立执行。
 */

type Modes = {
  framework?: {
    version?: string | null;
    adopted?: boolean;
    managedCount?: number;
    scanned?: boolean;
    drift?: { ok?: number; modified?: number; missing?: number; customized?: number };
  } | null;
  execution?: string;
  autonomy?: { enabled?: boolean; policyValid?: boolean | null; status?: string | null; expiresAt?: string | null };
  dispatch?: {
    enabled?: boolean;
    assignments?: Record<string, string>;
    agents?: Array<{ id: string; transport: string; modelFamily: string | null }>;
    familyExclusive?: boolean | null;
    issues?: string[];
  };
  gate?: { pubInstalled?: boolean; guardMode?: string };
  machinery?: { denyListMerged?: boolean | null; hooks?: string[]; missing?: string[] };
};

// 指引里的命令是**可照抄的**：写成占位符（<框架源树>）而不是某台机器上的绝对路径，
// 因为看这个页面的人未必在装着框架仓库的那台机器上。
const SYNC_CMD = "bash .claude/harness.sh sync --from <框架源树>";
const ADOPT_CMD = "bash <框架源树>/templates/claude/harness.sh adopt --from <框架源树> --as <当时版本>";
// 「有账本但基准线未知」时**不能**给 adopt —— 它在 harness.lock 已存在时会直接拒绝执行，
// 给了等于给一条跑不通的建议（两家外部 evaluator 都指出了这点）。真正可执行的是先删账本
// 再以确认过的版本重建；把 rm 写在前面是刻意的：让人看清这条命令会丢掉现有账本。
const REBASE_CMD =
  "rm harness.json harness.lock && bash <框架源树>/templates/claude/harness.sh adopt --from <框架源树> --as <确认后的版本>";

const PILL = "rounded-full px-2 py-0.5 text-xs";
const NEUTRAL = `${PILL} bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300`;
const GOOD = `${PILL} bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300`;
const WARN = `${PILL} bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300`;
const BAD = `${PILL} bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300`;

export default async function ModeBadges({ modes }: { modes: unknown }) {
  const t = await getTranslations("harness.modes");
  if (!modes || typeof modes !== "object") {
    // 关键区分：**没上报**不等于「所有模式都关着」。老 agent 就会落到这里。
    return <p className="mt-2 text-xs text-gray-400">{t("noSnapshot")}</p>;
  }
  const m = modes as Modes;
  const standing = frameworkStanding(m.framework?.version);
  const drift = m.framework?.drift;
  const dirty = (drift?.modified ?? 0) + (drift?.missing ?? 0);
  const customized = drift?.customized ?? 0;
  const issues = [...(m.dispatch?.issues ?? [])];
  if (m.machinery?.denyListMerged === false) issues.push(t("denyListMissing"));
  if ((m.machinery?.missing ?? []).length > 0) issues.push(`${t("hooksMissing")}: ${m.machinery!.missing!.join(", ")}`);

  const assignments = m.dispatch?.assignments ?? {};
  const pair = [assignments.generator, assignments.evaluator].filter(Boolean).join(" → ");

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        <span className={NEUTRAL}>{t(`execution.${m.execution ?? "unknown"}`)}</span>

        {m.autonomy?.enabled ? (
          <span className={m.autonomy.policyValid === false ? BAD : GOOD}>
            {m.autonomy.policyValid === false ? t("autonomyInvalid") : t("autonomyOn")}
            {m.autonomy.status ? `:${m.autonomy.status}` : ""}
          </span>
        ) : (
          <span className={NEUTRAL}>{t("autonomyOff")}</span>
        )}

        {m.dispatch?.enabled ? (
          <span className={m.dispatch.familyExclusive === false ? BAD : GOOD} title={pair}>
            {t("dispatchOn")}
            {m.dispatch.familyExclusive === false ? ` ⚠ ${t("sameFamily")}` : ""}
          </span>
        ) : (
          <span className={NEUTRAL}>{t("dispatchOff")}</span>
        )}

        <span className={m.gate?.pubInstalled ? GOOD : NEUTRAL}>
          {m.gate?.pubInstalled ? t("gateSignature") : t("gateHeadCompare")}
        </span>

        {/* 版本徽章的颜色由**落后与否**决定，而不是漂移数：一个改了 16 个文件但跑在最新
            框架上的项目是健康的；一个零改动却落后 9 版的项目才是要处理的。 */}
        <span
          className={standing.kind === "behind" ? WARN : standing.kind === "unknown" ? BAD : NEUTRAL}
          title={`${m.framework?.managedCount ?? 0} managed · latest v${standing.latest}`}
        >
          {/* adopt 时推断不出基准版本的项目版本号是字面量 "unknown" —— 渲染成 "vunknown" 会
              让人以为那是个版本名。「无账本」与「有账本但版本推断不出」是两种不同状态，分开说。 */}
          {!m.framework?.version
            ? t("noFramework")
            : m.framework.version === "unknown"
              ? t("versionUnknown")
              : `v${m.framework.version}`}
          {m.framework?.adopted ? " (adopted)" : ""}
          {standing.kind === "behind"
            ? ` · ${standing.behind !== null ? t("behindN", { count: standing.behind }) : t("behind")}`
            : ""}
          {standing.kind === "ahead" ? ` · ${t("ahead", { latest: standing.latest })}` : ""}
          {dirty > 0 ? ` · ${t("drift", { count: dirty })}` : ""}
          {customized > 0 ? ` · ${t("customized", { count: customized })}` : ""}
        </span>
      </div>

      {/* 指引只在**有事可做**时出现：最新的项目不该被一行永远不变的提示占着位置。 */}
      {standing.kind === "behind" ? (
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          {t("syncHint")} <code className="rounded bg-gray-100 px-1 dark:bg-white/10">{SYNC_CMD}</code>
        </p>
      ) : null}
      {standing.kind === "unknown" && m.framework === null ? (
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          {t("adoptHint")} <code className="rounded bg-gray-100 px-1 dark:bg-white/10">{ADOPT_CMD}</code>
        </p>
      ) : null}
      {standing.kind === "unknown" && m.framework !== null ? (
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          {t("unknownBaselineHint")}{" "}
          <code className="rounded bg-gray-100 px-1 dark:bg-white/10">{REBASE_CMD}</code>
        </p>
      ) : null}

      {pair ? (
        <p className="font-mono text-[11px] text-gray-500 dark:text-gray-400">
          {t("roles")}: {pair}
        </p>
      ) : null}

      {issues.length > 0 ? (
        <ul className="space-y-0.5">
          {issues.map((issue) => (
            <li key={issue} className="text-[11px] text-red-500">
              ⚠ {issue}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
