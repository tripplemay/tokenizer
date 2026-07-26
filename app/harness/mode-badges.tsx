import { getTranslations } from "next-intl/server";

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

        <span className={dirty > 0 ? WARN : NEUTRAL} title={`${m.framework?.managedCount ?? 0} managed`}>
          {/* adopt 时推断不出基准版本的项目版本号是字面量 "unknown" —— 渲染成 "vunknown" 会
              让人以为那是个版本名。「无账本」与「有账本但版本推断不出」是两种不同状态，分开说。 */}
          {!m.framework?.version
            ? t("noFramework")
            : m.framework.version === "unknown"
              ? t("versionUnknown")
              : `v${m.framework.version}`}
          {m.framework?.adopted ? " (adopted)" : ""}
          {dirty > 0 ? ` · ${t("drift", { count: dirty })}` : ""}
          {customized > 0 ? ` · ${t("customized", { count: customized })}` : ""}
        </span>
      </div>

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
