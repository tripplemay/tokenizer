import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  MdCheckCircle,
  MdComputer,
  MdDeviceHub,
  MdErrorOutline,
  MdLock,
  MdMemory,
  MdOutlineShield,
  MdPendingActions,
  MdSmartToy
} from "react-icons/md";
import Card from "@/components/card";
import type { OwnedHarnessProjectDetail } from "@/server/harness-detail";
import {
  currentHarnessModeSummary,
  modeIssuanceBlocker,
  parseHarnessDetailFeatures,
  parseHarnessDetailModes,
  type HarnessDesiredSummary,
  type HarnessDetailIntegration,
  type HarnessDetailModes
} from "@/shared/harness-detail";
import { HARNESS_MODE_ROLES, type HarnessModeRole } from "@/shared/harness-mode-intent";
import { formatDateTimeSeconds, formatRelativeTime, formatTokens } from "@/shared/format";
import { isFreshHarnessProjectReport } from "@/shared/device-status";
import { buildTransitionTimeline } from "@/shared/harness-transitions";
import { EvidenceList } from "../evidence-list";
import { safeHttpUrl } from "@/shared/url";
import {
  isConfigurableModeRole,
  modeDrilldownHref,
  type ModeDrilldownTarget
} from "./mode-drilldown";
import { ModeEditor } from "./mode-editor";

const PHASES = ["new", "planning", "building", "verifying", "fixing", "reverifying", "done"] as const;
const ACTIVE_INTENTS = new Set(["issued", "relayed", "staged"]);

type Translator = Awaited<ReturnType<typeof getTranslations>>;

function phaseLabel(t: Translator, value: string | null): string {
  return value && PHASES.some((phase) => phase === value)
    ? t(`phase.${value}`)
    : value ?? "—";
}

function intentLabel(t: Translator, value: string): string {
  return t.has(`intent.${value}`) ? t(`intent.${value}`) : value;
}

function featureStatusLabel(t: Translator, value: string | null): string {
  return value && t.has(`feature.${value}`) ? t(`feature.${value}`) : value ?? "—";
}

function Fact({ label, children, mono = false }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0 px-1 py-3 sm:px-3">
      <dt className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className={`mt-1 min-w-0 break-words text-sm text-navy-700 dark:text-white ${mono ? "font-mono" : ""}`}>{children}</dd>
    </div>
  );
}

function SectionTitle({ children, icon: Icon }: { children: React.ReactNode; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-bold uppercase text-gray-600 dark:text-white">
      <Icon className="h-5 w-5" />
      {children}
    </h2>
  );
}

async function evidenceLabelsFor(): Promise<{ repoDoc: string; path: string; copy: string; copied: string }> {
  const t = await getTranslations("harness.evidence");
  return { repoDoc: t("repoDoc"), path: t("path"), copy: t("copy"), copied: t("copied") };
}

export async function OverviewView({ project, timezone }: { project: OwnedHarnessProjectDetail; timezone: string }) {
  const [t, statusT, allT] = await Promise.all([
    getTranslations("harness.detail"),
    getTranslations("harness.status"),
    getTranslations()
  ]);
  const evidenceLabels = await evidenceLabelsFor();
  const features = parseHarnessDetailFeatures(project.features);
  const completion = project.totalCount > 0
    ? Math.round((project.completedCount / project.totalCount) * 100)
    : 0;
  const phaseIndex = PHASES.findIndex((phase) => phase === project.status);
  const pendingGate = project.gates.find((gate) => !gate.consumedAt) ?? null;
  const reportIsFresh = isFreshHarnessProjectReport(project.reportedAt, Date.now());

  return (
    <div className="min-w-0 space-y-7">
      {!reportIsFresh ? (
        <div role="alert" className="flex items-start gap-2 border-y border-amber-300 py-3 text-sm text-amber-700 dark:border-amber-500/40 dark:text-amber-300">
          <MdErrorOutline className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{t("overview.historicalSnapshot")}</span>
        </div>
      ) : null}
      <section className="space-y-3">
        <SectionTitle icon={MdComputer}>{t("overview.identity")}</SectionTitle>
        <dl className="grid min-w-0 grid-cols-1 divide-y divide-gray-200 border-y border-gray-200 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4 dark:divide-white/10 dark:border-white/10">
          <Fact label={t("overview.project")}>{project.name}</Fact>
          <Fact label={t("overview.device")}> 
            <Link href={`/devices/${encodeURIComponent(project.device.id)}`} className="font-medium text-brand-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              {project.device.name}
            </Link>
            <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
              {[project.device.hostname, project.device.platform].filter(Boolean).join(" · ") || t("notReported")}
            </span>
          </Fact>
          <Fact label={t("overview.repoKey")} mono><span className="break-all">{project.repoKey}</span></Fact>
          <Fact label={t("overview.dashboard")}>
            {safeHttpUrl(project.dashboardUrl) ? (
              <a
                href={safeHttpUrl(project.dashboardUrl)!}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all font-medium text-brand-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {safeHttpUrl(project.dashboardUrl)}
              </a>
            ) : t("notReported")}
          </Fact>
          <Fact label={t("overview.linkedProject")}>
            {project.project ? (
              <Link href={`/projects/${encodeURIComponent(project.project.id)}`} className="font-medium text-brand-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                {project.project.name}
              </Link>
            ) : t("notLinked")}
          </Fact>
        </dl>
        <dl className="grid min-w-0 grid-cols-1 divide-y divide-gray-200 border-b border-gray-200 sm:grid-cols-2 sm:divide-x sm:divide-y-0 dark:divide-white/10 dark:border-white/10">
          <Fact label={t("overview.head")} mono><span className="break-all">{project.headSha ?? t("notReported")}</span></Fact>
          <Fact label={t("overview.reportFreshness")}>
            {formatRelativeTime(project.reportedAt, allT, timezone)}
            <span className="mt-0.5 block font-mono text-xs text-gray-400">{formatDateTimeSeconds(project.reportedAt, timezone)}</span>
          </Fact>
        </dl>
      </section>

      <section className="space-y-3">
        <SectionTitle icon={MdDeviceHub}>{t("overview.progress")}</SectionTitle>
        <dl className="grid grid-cols-2 divide-x divide-y divide-gray-200 border-y border-gray-200 md:grid-cols-4 dark:divide-white/10 dark:border-white/10">
          <Fact label={t("overview.batch")} mono>{project.batch ?? t("notReported")}</Fact>
          <Fact label={t("overview.status")}>{phaseLabel(statusT, project.status)}</Fact>
          <Fact label={t("overview.completion")}>{project.completedCount}/{project.totalCount} · {completion}%</Fact>
          <Fact label={t("overview.fixRounds")}>{project.fixRounds}</Fact>
        </dl>
        <div className="max-w-full overflow-x-auto pb-1">
          <ol className="flex min-w-max items-center gap-1" aria-label={t("overview.trajectory")}>
            {PHASES.map((phase, index) => (
              <li key={phase} className="flex items-center">
                <span className={`rounded px-2 py-1 font-mono text-xs ${
                  phase === project.status
                    ? "bg-brand-500 text-white"
                    : index < phaseIndex
                      ? "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300"
                      : "bg-gray-100 text-gray-400 dark:bg-white/5 dark:text-gray-500"
                }`}>
                  {phaseLabel(statusT, phase)}
                </span>
                {index < PHASES.length - 1 ? <span className="mx-1 text-gray-300 dark:text-gray-600">→</span> : null}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="min-w-0 space-y-3">
        <SectionTitle icon={MdCheckCircle}>{t("overview.features")}</SectionTitle>
        {features.length === 0 ? (
          <p className="border-y border-gray-200 py-4 text-sm text-gray-500 dark:border-white/10 dark:text-gray-400">{t("overview.noFeatures")}</p>
        ) : (
          <div className="max-w-full overflow-x-auto border-y border-gray-200 dark:border-white/10">
            <table className="w-full min-w-[620px] table-fixed text-left text-sm">
              <thead className="text-xs uppercase text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="w-24 px-3 py-3">{t("overview.featureId")}</th>
                  <th className="px-3 py-3">{t("overview.featureTitle")}</th>
                  <th className="w-32 px-3 py-3">{t("overview.featureExecutor")}</th>
                  <th className="w-32 px-3 py-3">{t("overview.featureStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {features.map((feature) => (
                  <tr key={feature.id} className="border-t border-gray-200 dark:border-white/10">
                    <td className="break-all px-3 py-3 font-mono text-xs text-navy-700 dark:text-white">{feature.id}</td>
                    <td className="break-words px-3 py-3 text-gray-700 dark:text-gray-200">{feature.title ?? "—"}</td>
                    <td className="break-all px-3 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">{feature.executor ?? "—"}</td>
                    <td className="break-all px-3 py-3 text-xs text-gray-600 dark:text-gray-300">{featureStatusLabel(statusT, feature.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle icon={MdPendingActions}>{t("overview.outcomes")}</SectionTitle>
        <dl className="grid grid-cols-1 divide-y divide-gray-200 border-y border-gray-200 md:grid-cols-3 md:divide-x md:divide-y-0 dark:divide-white/10 dark:border-white/10">
          <Fact label={t("overview.signoff")} mono><span className="break-all">{project.signoff ?? t("notReported")}</span></Fact>
          <Fact label={t("overview.lastHalt")}>
            {project.lastHaltCondition ? (
              <span className="break-words text-red-600 dark:text-red-300">
                <span className="font-mono">{project.lastHaltCondition}</span>
                {project.lastHaltDetail ? <span className="mt-1 block">{project.lastHaltDetail}</span> : null}
              </span>
            ) : t("overview.noHalt")}
          </Fact>
          <Fact label={t("overview.pendingGate")}>
            {pendingGate ? (
              <span className="block min-w-0">
                <span className="break-all font-mono">{pendingGate.gateId}</span>
                <span className="mt-1 block break-words text-xs text-gray-500 dark:text-gray-400">
                  {pendingGate.kind} · {pendingGate.fromStatus ?? "—"} → {pendingGate.toStatus ?? "—"}
                </span>
                <span className="mt-1 block break-words text-xs">{pendingGate.detail}</span>
                <EvidenceList evidence={pendingGate.evidence} labels={evidenceLabels} />
              </span>
            ) : t("overview.noPendingGate")}
          </Fact>
        </dl>
      </section>
    </div>
  );
}

function ModeSummary({
  title,
  summary,
  empty,
  t
}: {
  title: string;
  summary: HarnessDesiredSummary | null;
  empty: string;
  t: Translator;
}) {
  return (
    <section className="min-w-0 border-y border-gray-200 py-4 dark:border-white/10">
      <h3 className="text-xs font-bold uppercase text-gray-500 dark:text-gray-400">{title}</h3>
      {!summary ? <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{empty}</p> : (
        <dl className="mt-3 space-y-3">
          <Fact label={t("modes.execution")}>{t(`modes.profile.${summary.execution.profile}`)}</Fact>
          <Fact label={t("modes.roles")} mono>
            {summary.execution.roleBindings
              ? roleBindingSummary(summary.execution.roleBindings, t("modes.coordinator.title"))
              : summary.execution.roleAssignments
              ? `${summary.execution.roleAssignments.generator} → ${summary.execution.roleAssignments.evaluator}`
              : summary.execution.profile === "fast"
                ? t("modes.defaultRoles")
                : t("modes.rolesUnavailable")}
          </Fact>
          <Fact label={t("modes.autonomy")}>
            {summary.autonomy.enabled ? t("modes.autonomyOn") : t("modes.autonomyOff")}
            {summary.autonomy.expiresAt ? <span className="mt-1 block break-all font-mono text-xs text-gray-400">{summary.autonomy.expiresAt}</span> : null}
          </Fact>
        </dl>
      )}
    </section>
  );
}

function roleBindingSummary(
  bindings: NonNullable<HarnessDesiredSummary["execution"]["roleBindings"]>,
  coordinator: string
): string {
  return ["planner", "generator", "evaluator"]
    .map((role) => {
      const binding = bindings[role as keyof typeof bindings];
      if (binding === null) return `${role}: ${coordinator}`;
      return `${role}: ${binding.tool} · ${binding.invocation}${binding.modelFamily ? ` · ${binding.modelFamily}` : ""}`;
    })
    .join(" | ");
}

export async function ModesAndAgentsView({
  project,
  canSign,
  timezone,
  selectedFocus
}: {
  project: OwnedHarnessProjectDetail;
  canSign: boolean;
  timezone: string;
  selectedFocus: ModeDrilldownTarget | null;
}) {
  const [t, statusT] = await Promise.all([
    getTranslations("harness.detail"),
    getTranslations("harness.status")
  ]);
  const modes = parseHarnessDetailModes(project.modes);
  const activeIntent = project.modeIntents.find((intent) => ACTIVE_INTENTS.has(intent.status)) ?? null;
  const pendingSummary = modes?.pendingDefaults ?? null;
  const blocker = modeIssuanceBlocker({
    signingKeyReady: canSign,
    reportedAt: project.reportedAt,
    agentFeatureVersion: project.device.agentFeatureVersion,
    headSha: project.headSha,
    modes,
    now: new Date(),
    // This screen issues the tool-bound role contract. Check the Agent's
    // bridge/catalog capability before parsing a legacy snapshot so users see
    // the actionable upgrade requirement instead of a generic catalog error.
    requiresToolBindings: true
  });
  const editorTools = modes?.dispatch.toolCatalogUsable ? modes.dispatch.toolCatalog : [];
  const selectedRole = isConfigurableModeRole(selectedFocus) ? selectedFocus : null;
  const currentRoleBinding = selectedRole && modes?.current
    ? modes.current.roleBindings[selectedRole]
    : undefined;
  const pendingBindings = modes?.pendingDefaults?.execution.roleBindings;
  const pendingRoleBinding = selectedRole && pendingBindings
    ? pendingBindings[selectedRole]
    : undefined;

  return (
    <div className="min-w-0 space-y-7">
      <section className="space-y-3">
        <SectionTitle icon={MdDeviceHub}>{t("modes.compare")}</SectionTitle>
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <ModeSummary title={t("modes.current")} summary={currentHarnessModeSummary(modes)} empty={t("modes.noCurrent")} t={t} />
          <ModeSummary title={t("modes.pendingNextPlan")} summary={pendingSummary} empty={t("modes.noPending")} t={t} />
        </div>
        {modes?.pendingDefaults ? (
          <p className="break-words text-xs text-gray-500 dark:text-gray-400">
            {t("modes.staged", {
              at: formatDateTimeSeconds(modes.pendingDefaults.stagedAt, timezone),
              expires: formatDateTimeSeconds(modes.pendingDefaults.intentExpiresAt, timezone)
            })}
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <SectionTitle icon={MdSmartToy}>{t("modes.integrations")}</SectionTitle>
        {modes?.dispatch.integrations.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <CoordinatorCard projectId={project.id} selected={selectedFocus === "coordinator"} t={t} />
            {modes.dispatch.integrations.map((integration) => (
              <IntegrationCard
                key={integration.id}
                projectId={project.id}
                integration={integration}
                tools={editorTools}
                selectedRole={selectedRole}
                t={t}
                statusT={statusT}
              />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <CoordinatorCard projectId={project.id} selected={selectedFocus === "coordinator"} t={t} />
            <p className="border-y border-gray-200 py-4 text-sm text-gray-500 dark:border-white/10 dark:text-gray-400">{t("modes.noIntegrations")}</p>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle icon={MdOutlineShield}>{t("modes.health")}</SectionTitle>
        <dl className="grid grid-cols-1 divide-y divide-gray-200 border-y border-gray-200 md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-5 dark:divide-white/10 dark:border-white/10">
          <HealthFact label={t("modes.healthFacts.frameworkDrift")} value={frameworkHealth(modes, t)} good={Boolean(modes?.framework?.drift && modes.framework.drift.modified === 0 && modes.framework.drift.missing === 0)} />
          <HealthFact label={t("modes.healthFacts.familyExclusive")} value={healthBoolean(modes?.dispatch.familyExclusive, statusT)} good={modes?.dispatch.familyExclusive === true} />
          <HealthFact label={t("modes.healthFacts.hooks")} value={modes ? t("modes.healthFacts.hookCount", { installed: modes.machinery.hooks.length, missing: modes.machinery.missing.length }) : statusT("health.unknown")} good={Boolean(modes && modes.machinery.missing.length === 0)} />
          <HealthFact label={t("modes.healthFacts.denyList")} value={healthBoolean(modes?.machinery.denyListMerged, statusT)} good={modes?.machinery.denyListMerged === true} />
          <HealthFact label={t("modes.healthFacts.gateSignature")} value={modes?.gate.guardMode ?? statusT("health.unknown")} good={modes?.gate.guardMode === "signature"} />
        </dl>
        {modes?.dispatch.issues.length ? (
          <ul className="space-y-1 text-sm text-red-600 dark:text-red-300">
            {modes.dispatch.issues.map((issue) => <li key={issue} className="break-words">{issue}</li>)}
          </ul>
        ) : null}
      </section>

      <ModeEditor
        projectId={project.id}
        tools={editorTools}
        integrations={modes?.dispatch.integrations ?? []}
        agentFeatureVersion={project.device.agentFeatureVersion}
        blocker={blocker}
        selectedRole={selectedRole}
        currentRoleBinding={currentRoleBinding}
        pendingRoleBinding={pendingRoleBinding}
        currentIntent={activeIntent ? {
          intentId: activeIntent.intentId,
          status: activeIntent.status,
          issuedAt: formatDateTimeSeconds(activeIntent.issuedAt, timezone),
          intentExpiresAt: formatDateTimeSeconds(activeIntent.intentExpiresAt, timezone),
          canCancel: activeIntent.status === "issued" || activeIntent.status === "relayed"
        } : null}
      />
    </div>
  );
}

function configurableRoles(integration: HarnessDetailIntegration, tools: HarnessDetailModes["dispatch"]["toolCatalog"]): HarnessModeRole[] {
  const availableRoles = new Set(tools.map((tool) => tool.role));
  return HARNESS_MODE_ROLES.filter((role) => integration.roles.includes(role) && availableRoles.has(role));
}

function IntegrationCard({
  projectId,
  integration,
  tools,
  selectedRole,
  t,
  statusT
}: {
  projectId: string;
  integration: HarnessDetailIntegration;
  tools: HarnessDetailModes["dispatch"]["toolCatalog"];
  selectedRole: HarnessModeRole | null;
  t: Translator;
  statusT: Translator;
}) {
  const roles = configurableRoles(integration, tools);
  return (
    <Card extra="!rounded-lg border border-gray-200 !p-4 dark:border-white/10">
      <div className="min-w-0 space-y-3">
        <div className="flex min-w-0 items-start gap-2">
          <MdMemory className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
          <div className="min-w-0">
            <h3 className="break-words text-sm font-bold text-navy-700 dark:text-white">{integration.label}</h3>
            <p className="mt-0.5 break-all font-mono text-xs text-gray-500 dark:text-gray-400">{integration.tool}</p>
          </div>
        </div>
        <dl className="space-y-2 text-xs">
          <ModeFact label={t("modes.integration.roles")} value={integration.roles.join(", ") || t("notReported")} />
          <ModeFact label={t("modes.integration.capabilities")} value={integration.capabilities.join(", ") || t("notReported")} />
          <ModeFact label={t("modes.integration.modelFamily")} value={integration.modelFamily} />
          <ModeFact label={t("modes.integration.invocations")} value={integration.invocations.join(", ")} />
          {integration.subagent ? (
            <>
              <ModeFact
                label={t("modes.integration.subagentPath")}
                value={integration.sessionScope === "same-session" && integration.bridgeKind
                  ? t("modes.integration.sameSessionBridge", { kind: integration.bridgeKind })
                  : t("modes.integration.hostNative")}
              />
              {integration.bridgeId ? <ModeFact label={t("modes.integration.bridgeId")} value={integration.bridgeId} /> : null}
            </>
          ) : null}
          <ModeFact
            label={t("modes.integration.sandbox")}
            value={integration.localCli
              ? integration.sandboxed ? statusT("health.installed") : statusT("health.missing")
              : t("modes.integration.notApplicable")}
          />
          {integration.a2aTargetCount > 0 ? <ModeFact label={t("modes.integration.a2aTargets")} value={String(integration.a2aTargetCount)} /> : null}
        </dl>
        {roles.length ? (
          <nav aria-label={t("modes.integration.configureRoles", { integration: integration.label })} className="border-t border-gray-200 pt-3 dark:border-white/10">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{t("modes.integration.configure")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {roles.map((role) => (
                <Link
                  key={role}
                  href={modeDrilldownHref(projectId, role)}
                  aria-current={selectedRole === role ? "location" : undefined}
                  className={`inline-flex min-h-8 items-center rounded-md border px-2.5 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                    selectedRole === role
                      ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200"
                      : "border-gray-200 text-brand-600 hover:bg-gray-50 dark:border-white/10 dark:text-brand-300 dark:hover:bg-white/5"
                  }`}
                >
                  {t("modes.integration.configureRole", { role: t(`modes.role.${role}`) })}
                </Link>
              ))}
            </div>
          </nav>
        ) : (
          <p className="border-t border-gray-200 pt-3 text-xs text-gray-500 dark:border-white/10 dark:text-gray-400">{t("modes.integration.noConfigurableRoles")}</p>
        )}
      </div>
    </Card>
  );
}

function CoordinatorCard({ projectId, selected, t }: { projectId: string; selected: boolean; t: Translator }) {
  return (
    <Card
      id="coordinator-details"
      data-coordinator-readonly="true"
      extra={`scroll-mt-6 !rounded-lg border !p-4 ${
        selected
          ? "border-brand-500 ring-2 ring-brand-500/20 dark:border-brand-300"
          : "border-brand-200 dark:border-brand-500/30"
      }`}
    >
      <div className="min-w-0 space-y-3">
        <div className="flex min-w-0 items-start gap-2">
          <MdLock className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
          <div className="min-w-0">
            <h3 className="break-words text-sm font-bold text-navy-700 dark:text-white">{t("modes.coordinator.title")}</h3>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t("modes.coordinator.locked")}</p>
          </div>
        </div>
        <dl className="space-y-2 text-xs">
          <ModeFact label={t("modes.coordinator.assignment")} value={t("modes.coordinator.assignmentValue")} />
          <ModeFact label={t("modes.coordinator.configuration")} value={t("modes.coordinator.configurationValue")} />
          <ModeFact label={t("modes.coordinator.runtime")} value={t("modes.coordinator.runtimeValue")} />
        </dl>
        <div className="border-t border-brand-100 pt-3 dark:border-brand-500/20">
          <p className="text-xs text-gray-500 dark:text-gray-400">{t("modes.coordinator.readOnlyReason")}</p>
          <Link
            href={modeDrilldownHref(projectId, "coordinator")}
            aria-current={selected ? "location" : undefined}
            className="mt-2 inline-flex min-h-8 items-center rounded-md border border-brand-200 px-2.5 py-1 text-xs font-semibold text-brand-600 transition hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-brand-500/30 dark:text-brand-300 dark:hover:bg-brand-500/10"
          >
            {t("modes.coordinator.openDetails")}
          </Link>
        </div>
      </div>
    </Card>
  );
}

function ModeFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[7rem_minmax(0,1fr)] gap-2">
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="break-all font-mono text-navy-700 dark:text-white">{value}</dd>
    </div>
  );
}

function HealthFact({ label, value, good }: { label: string; value: string; good: boolean }) {
  const Icon = good ? MdCheckCircle : MdErrorOutline;
  return (
    <div className="min-w-0 px-3 py-4">
      <dt className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className={`mt-2 flex min-w-0 items-start gap-2 break-words text-sm ${good ? "text-green-700 dark:text-green-300" : "text-amber-700 dark:text-amber-300"}`}>
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{value}</span>
      </dd>
    </div>
  );
}

function healthBoolean(value: boolean | null | undefined, t: Translator): string {
  if (value === true) return t("health.installed");
  if (value === false) return t("health.missing");
  return t("health.unknown");
}

function frameworkHealth(modes: HarnessDetailModes | null, t: Translator): string {
  const drift = modes?.framework?.drift;
  if (!drift) return t("modes.healthFacts.notScanned");
  return t("modes.healthFacts.driftCounts", {
    modified: drift.modified,
    missing: drift.missing,
    customized: drift.customized
  });
}

export async function ActivityView({ project, timezone }: { project: OwnedHarnessProjectDetail; timezone: string }) {
  const evidenceLabels = await evidenceLabelsFor();
  const [t, statusT] = await Promise.all([
    getTranslations("harness.activity"),
    getTranslations("harness.status")
  ]);
  return (
    <div className="min-w-0 space-y-8">
      <section className="space-y-3">
        <SectionTitle icon={MdPendingActions}>{t("modeIntents")}</SectionTitle>
        {project.modeIntents.length === 0 ? <Empty text={t("noModeIntents")} /> : (
          <ol className="space-y-0 border-l border-gray-200 pl-4 dark:border-white/10">
            {project.modeIntents.map((intent) => (
              <li key={intent.id} className="relative border-b border-gray-200 py-4 last:border-b-0 dark:border-white/10">
                <span className="absolute -left-[1.28rem] top-5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-500 dark:border-navy-900" />
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-all font-mono text-sm font-bold text-navy-700 dark:text-white">{intent.intentId}</p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {intentLabel(statusT, intent.status)} · {intent.issuedBy}
                    </p>
                  </div>
                  <time className="font-mono text-xs text-gray-400">{formatDateTimeSeconds(intent.issuedAt, timezone)}</time>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                  <span>{t("expires")}: {formatDateTimeSeconds(intent.intentExpiresAt, timezone)}</span>
                  {intent.relayedAt ? <span>{t("relayed")}: {formatDateTimeSeconds(intent.relayedAt, timezone)}</span> : null}
                  {intent.stagedAt ? <span>{t("staged")}: {formatDateTimeSeconds(intent.stagedAt, timezone)}</span> : null}
                  {intent.appliedAt ? <span>{t("applied")}: {formatDateTimeSeconds(intent.appliedAt, timezone)}</span> : null}
                </div>
                {intent.stagedCommitSha ? <p className="mt-2 break-all font-mono text-xs text-gray-400">{intent.stagedCommitSha}</p> : null}
                {intent.appliedBatch ? <p className="mt-2 break-all text-xs text-gray-500 dark:text-gray-400">{t("appliedBatch")}: {intent.appliedBatch}</p> : null}
                {intent.failureCode || intent.failureDetail ? (
                  <p className="mt-2 break-words rounded-md bg-red-50 px-3 py-2 font-mono text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
                    {[intent.failureCode, intent.failureDetail].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle icon={MdOutlineShield}>{t("gates")}</SectionTitle>
        {project.gates.length === 0 ? <Empty text={t("noGates")} /> : (
          <div className="divide-y divide-gray-200 border-y border-gray-200 dark:divide-white/10 dark:border-white/10">
            {project.gates.map((gate) => (
              <article key={gate.id} className="min-w-0 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-all font-mono text-sm font-bold text-navy-700 dark:text-white">{gate.gateId}</p>
                    <p className="mt-1 break-words text-xs text-gray-500 dark:text-gray-400">
                      {gate.kind} · {gate.batch} · {gate.fromStatus ?? "—"} → {gate.toStatus ?? "—"}
                    </p>
                  </div>
                  <time className="font-mono text-xs text-gray-400">{formatDateTimeSeconds(gate.raisedAt, timezone)}</time>
                </div>
                <p className="mt-2 break-words text-sm text-gray-700 dark:text-gray-200">{gate.detail}</p>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  {gate.consumedAt
                    ? statusT("gate.consumed")
                    : gate.relayedAt
                      ? statusT("gate.relayed")
                      : gate.decisionAction
                        ? statusT("gate.signed")
                        : statusT("gate.pending")}
                  {gate.decisionAction === "approve" ? ` · ${statusT("gate.approved")}` : ""}
                  {gate.decisionAction === "reject" ? ` · ${statusT("gate.rejected")}` : ""}
                  {gate.decisionBy ? ` · ${gate.decisionBy}` : ""}
                </p>
                {gate.decisionNote ? <p className="mt-1 break-words text-xs text-gray-500 dark:text-gray-400">{gate.decisionNote}</p> : null}
                <EvidenceList evidence={gate.evidence} labels={evidenceLabels} />
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="min-w-0 space-y-3">
        <SectionTitle icon={MdDeviceHub}>{t("dispatch")}</SectionTitle>
        {project.dispatchRuns.length === 0 ? <Empty text={t("noDispatch")} /> : (
          <div className="max-w-full overflow-x-auto border-y border-gray-200 dark:border-white/10">
            <table className="w-full min-w-[1180px] table-fixed text-left text-xs">
              <thead className="uppercase text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="w-40 px-3 py-3">{t("col.time")}</th>
                  <th className="w-36 px-3 py-3">{t("col.batch")}</th>
                  <th className="w-28 px-3 py-3">{t("col.feature")}</th>
                  <th className="w-44 px-3 py-3">{t("col.agent")}</th>
                  <th className="w-36 px-3 py-3">{t("col.execution")}</th>
                  <th className="w-36 px-3 py-3">{t("col.outcome")}</th>
                  <th className="w-28 px-3 py-3">{t("col.duration")}</th>
                  <th className="w-32 px-3 py-3">{t("col.tokens")}</th>
                  <th className="w-44 px-3 py-3">{t("col.artifact")}</th>
                  <th className="w-40 px-3 py-3">{t("col.failure")}</th>
                </tr>
              </thead>
              <tbody>
                {project.dispatchRuns.map((run) => (
                  <tr key={run.id} className="border-t border-gray-200 align-top dark:border-white/10">
                    <td className="px-3 py-3 font-mono text-gray-500 dark:text-gray-400">{formatDateTimeSeconds(run.startedAt, timezone)}</td>
                    <td className="break-all px-3 py-3 font-mono text-navy-700 dark:text-white">{run.batch}</td>
                    <td className="break-all px-3 py-3 font-mono">{run.feature ?? "—"}<span className="mt-1 block text-gray-400">{run.role}</span></td>
                    <td className="break-all px-3 py-3 font-mono">{run.agentId}<span className="mt-1 block text-gray-400">{run.modelFamily}</span></td>
                    <td className="break-all px-3 py-3 font-mono">{run.transport}<span className="mt-1 block text-gray-400">{run.lockedSha}</span></td>
                    <td className="break-all px-3 py-3">{run.outcome}{run.verdict ? <span className="mt-1 block font-mono text-gray-400">{run.verdict}</span> : null}</td>
                    <td className="px-3 py-3 font-mono">{durationLabel(run.durationMs, t)}</td>
                    <td className="px-3 py-3 font-mono" title={run.usageCapture ?? undefined}>
                      {run.usageInputTokens !== null && run.usageOutputTokens !== null
                        ? `${formatTokens(run.usageInputTokens)} / ${formatTokens(run.usageOutputTokens)}`
                        : "—"}
                      {run.usageCapture === "attribution_only" ? (
                        <span className="mt-1 block text-gray-400">{t("usageAttributionOnly")}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 font-mono">
                      {run.artifactPath ? <span className="break-all">{run.artifactPath}</span> : "—"}
                      {run.artifactSha256 ? (
                        <span className="mt-1 block text-gray-400" title={run.artifactSha256}>
                          {run.artifactSha256.slice(0, 12)}…
                        </span>
                      ) : null}
                    </td>
                    <td className="break-words px-3 py-3 font-mono text-red-600 dark:text-red-300">
                      {run.exitCode !== null ? `${t("exitCode")}: ${run.exitCode}` : "—"}
                      {run.errorSummary ? <span className="mt-1 block">{run.errorSummary}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function durationLabel(durationMs: number, t: Translator): string {
  return durationMs < 1000
    ? t("durationMs", { value: durationMs })
    : t("durationSeconds", { value: (durationMs / 1000).toFixed(1) });
}

function Empty({ text }: { text: string }) {
  return <p className="border-y border-gray-200 py-4 text-sm text-gray-500 dark:border-white/10 dark:text-gray-400">{text}</p>;
}

// ---- Timeline（BL-TRANSITION-LOG F003）--------------------------------------

function timelineDuration(durationMs: number): string {
  const totalMinutes = Math.round(durationMs / 60_000);
  if (totalMinutes < 1) return "<1m";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export async function TimelineView({ project, timezone }: { project: OwnedHarnessProjectDetail; timezone: string }) {
  const [t, statusT] = await Promise.all([
    getTranslations("harness.timeline"),
    getTranslations("harness.status")
  ]);
  const groups = buildTransitionTimeline(project.transitions, {
    now: new Date(),
    reportIsFresh: isFreshHarnessProjectReport(project.reportedAt, Date.now())
  });

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 dark:text-gray-400">{t("precisionNote")}</p>
      {groups.length === 0 ? <Empty text={t("empty")} /> : null}
      {groups.map((group, groupIndex) => (
        <Card key={`${group.batch ?? "unknown"}-${groupIndex}`} extra="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-mono text-sm font-semibold text-navy-700 dark:text-white">
              {group.batch ?? t("unknownBatch")}
            </h3>
            {group.totalMs !== null ? (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t("total", { value: timelineDuration(group.totalMs) })}
              </span>
            ) : null}
          </div>
          <ol className="mt-3 space-y-0">
            {group.segments.map((segment, index) => (
              <li key={`${segment.phase}-${index}`} className="relative flex gap-3 pb-4 last:pb-0">
                <div className="flex flex-col items-center">
                  <span
                    className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                      segment.end === null ? "bg-brand-500" : "bg-gray-300 dark:bg-white/20"
                    }`}
                  />
                  {index < group.segments.length - 1 ? (
                    <span className="mt-1 w-px flex-1 bg-gray-200 dark:bg-white/10" />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-navy-700 dark:text-white">
                      {phaseLabel(statusT, segment.phase)}
                    </span>
                    {segment.fixRounds > 0 && (segment.phase === "fixing" || segment.phase === "reverifying") ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                        {t("round", { value: segment.fixRounds })}
                      </span>
                    ) : null}
                    {segment.lowPrecision ? (
                      <span
                        title={t("lowPrecisionHint")}
                        className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-white/10 dark:text-gray-400"
                      >
                        {t("lowPrecision")}
                      </span>
                    ) : null}
                    {segment.nonAdjacent ? (
                      <span
                        title={t("compressedHint")}
                        className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-white/10 dark:text-gray-400"
                      >
                        {t("compressed")}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-gray-500 dark:text-gray-400">
                    {formatDateTimeSeconds(segment.start, timezone)}
                    {" · "}
                    {segment.end === null
                      ? segment.durationMs !== null
                        ? t("inProgressFor", { value: timelineDuration(segment.durationMs) })
                        : t("inProgress")
                      : segment.durationMs !== null
                        ? `${segment.initialObservation ? "≥" : ""}${timelineDuration(segment.durationMs)}`
                        : "—"}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      ))}
    </div>
  );
}
