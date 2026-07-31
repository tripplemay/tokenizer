"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MdDeleteOutline, MdSend } from "react-icons/md";
import Card from "@/components/card";
import Checkbox from "@/components/checkbox";
import Switch from "@/components/switch";
import {
  HARNESS_AUTONOMY_LIMITS,
  HarnessModeEditorValidationError,
  buildModeIntentRequest,
  type HarnessDetailToolCapability,
  type HarnessModeIssuanceBlocker
} from "@/shared/harness-detail";
import {
  MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION,
  requiredModeIntentAgentFeatureVersion
} from "@/shared/agent-feature-version";
import {
  HARNESS_AUTONOMY_GATES,
  HARNESS_AUTONOMY_NOTIFICATIONS,
  HARNESS_EXECUTION_PROFILES,
  type HarnessAutonomyGate,
  type HarnessAutonomyNotification,
  type HarnessExecutionProfile,
  type HarnessModeRole,
  type HarnessTransport
} from "@/shared/harness-mode-intent";
import { toolCatalogLabelForInvocation } from "@/shared/harness-tool-catalog";
import {
  MODE_EDITOR_ANCHOR,
  modeEditorFocusRegion,
  modeEditorFocusTarget,
  modeEditorInitialProfile
} from "./mode-drilldown";

type PendingIntent = {
  intentId: string;
  status: string;
  issuedAt: string;
  intentExpiresAt: string;
  canCancel: boolean;
};

type RoleBindingContext = {
  tool: string;
  invocation: HarnessTransport;
  modelFamily?: string;
} | null | undefined;

const ERROR_KEYS: Record<string, string> = {
  invalid_project: "invalidProject",
  invalid_profile: "invalidProfile",
  missing_agent: "missingAgent",
  missing_agents: "missingAgent",
  invalid_string: "missingAgent",
  duplicate_agent: "sameAgent",
  unknown_agent: "unknownAgent",
  role_not_allowed: "roleMismatch",
  same_model_family: "sameFamily",
  invalid_transport: "transportMismatch",
  profile_transport_mismatch: "transportMismatch",
  invalid_bindings: "toolBindingInvalid",
  missing_tool_catalog: "toolCatalogUnavailable",
  unknown_tool: "toolUnavailable",
  invalid_timestamp: "invalidDate",
  expired_intent: "expiredIntent",
  invalid_expiry: "expiredIntent",
  expired_autonomy: "expiredAutonomy",
  invalid_number: "invalidBudget",
  invalid_gate: "invalidGate",
  duplicate_gate: "invalidGate",
  invalid_notification: "invalidNotification",
  duplicate_notification: "invalidNotification",
  stale_report: "reportStale",
  agent_upgrade_required: "agentUpgradeRequired",
  tool_binding_agent_upgrade_required: "toolBindingAgentUpgradeRequired",
  invalid_project_head: "headNotFull",
  invalid_mode_snapshot: "agentSnapshotUnavailable",
  invalid_tool_catalog: "toolCatalogUnavailable",
  signing_unavailable: "signingKeyUnavailable",
  invalid_transition: "cannotCancel",
  state_conflict: "stateConflict"
};

class RequestError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function responseErrorCode(value: unknown): string {
  if (value && typeof value === "object" && "code" in value && typeof value.code === "string") {
    return value.code;
  }
  return "request_failed";
}

const INPUT =
  "w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-navy-700 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:cursor-not-allowed disabled:bg-gray-100 dark:border-white/10 dark:bg-navy-900 dark:text-white dark:disabled:bg-white/5";

export function ModeEditor({
  projectId,
  tools,
  agentFeatureVersion,
  blocker,
  selectedRole,
  currentRoleBinding,
  pendingRoleBinding,
  currentIntent
}: {
  projectId: string;
  tools: HarnessDetailToolCapability[];
  agentFeatureVersion: number | null;
  blocker: HarnessModeIssuanceBlocker | null;
  selectedRole: HarnessModeRole | null;
  currentRoleBinding: RoleBindingContext;
  pendingRoleBinding: RoleBindingContext;
  currentIntent: PendingIntent | null;
}) {
  const t = useTranslations("harness.editor");
  const statusT = useTranslations("harness.status.intent");
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const initialProfile = modeEditorInitialProfile(selectedRole);
  const [profile, setProfile] = useState<HarnessExecutionProfile>(() => initialProfile);
  const plannerOptions = roleToolOptions(tools, "planner");
  const generatorOptions = roleToolOptions(tools, "generator");
  const evaluatorOptions = roleToolOptions(tools, "evaluator");
  const initialBindings = initialNonFastBindingsForProfile(
    tools,
    initialProfile === "slow" ? "slow" : "heterogeneous"
  );
  // Planner defaults to the harness Coordinator. Choosing a tool opts into a
  // delegated planner at the next planning boundary.
  const [plannerTool, setPlannerTool] = useState<string>(initialBindings?.plannerTool ?? "");
  const [plannerInvocation, setPlannerInvocation] = useState<string>(initialBindings?.plannerInvocation ?? "");
  const [generatorTool, setGeneratorTool] = useState(initialBindings?.generatorTool ?? "");
  const [generatorInvocation, setGeneratorInvocation] = useState(initialBindings?.generatorInvocation ?? "");
  const [evaluatorTool, setEvaluatorTool] = useState(initialBindings?.evaluatorTool ?? "");
  const [evaluatorInvocation, setEvaluatorInvocation] = useState(initialBindings?.evaluatorInvocation ?? "");
  const [intentExpiresAt, setIntentExpiresAt] = useState("");
  const [autonomyEnabled, setAutonomyEnabled] = useState(false);
  const [autonomyExpiresAt, setAutonomyExpiresAt] = useState("");
  const [maxTokens, setMaxTokens] = useState("2000000");
  const [maxCostUsd, setMaxCostUsd] = useState("20");
  const [maxWakes, setMaxWakes] = useState("60");
  const [maxFixRounds, setMaxFixRounds] = useState("3");
  const [autoCross, setAutoCross] = useState<HarnessAutonomyGate[]>(["A"]);
  const [notifyOn, setNotifyOn] = useState<HarnessAutonomyNotification[]>(["halt", "done"]);
  const [busy, setBusy] = useState<"submit" | "delete" | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  function applyInitialBindings(bindings: InitialNonFastBindings) {
    setPlannerTool(bindings.plannerTool);
    setPlannerInvocation(bindings.plannerInvocation);
    setGeneratorTool(bindings.generatorTool);
    setGeneratorInvocation(bindings.generatorInvocation);
    setEvaluatorTool(bindings.evaluatorTool);
    setEvaluatorInvocation(bindings.evaluatorInvocation);
  }

  function selectProfile(nextProfile: HarnessExecutionProfile) {
    setProfile(nextProfile);
    if (nextProfile === "fast") return;
    if (nonFastBindingsAreSignable(
      nextProfile,
      plannerOptions,
      generatorOptions,
      evaluatorOptions,
      plannerTool,
      plannerInvocation,
      generatorTool,
      generatorInvocation,
      evaluatorTool,
      evaluatorInvocation
    )) return;
    const bindings = initialNonFastBindingsForProfile(tools, nextProfile);
    if (bindings) applyInitialBindings(bindings);
  }

  useEffect(() => {
    if (!selectedRole) return;
    if (profile === "fast") {
      setProfile("heterogeneous");
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const control = document.getElementById(modeEditorFocusTarget(selectedRole));
      const region = document.getElementById(modeEditorFocusRegion(selectedRole));
      const target = control instanceof HTMLSelectElement && !control.disabled ? control : region;
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [profile, selectedRole]);

  const baseDisabled = blocker !== null || busy !== null || refreshing;
  const supportsToolBindings = (agentFeatureVersion ?? 0) >= MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION;
  const toolBindingBlocker: HarnessModeIssuanceBlocker | null = profile === "fast"
    ? null
    : !supportsToolBindings
      ? "toolBindingAgentUpgradeRequired"
      : generatorOptions.length === 0 || evaluatorOptions.length === 0
        ? "toolCatalogUnavailable"
        : null;
  const submitDisabled = baseDisabled || toolBindingBlocker !== null;
  const selectedRoleCapabilities = selectedRole ? tools.filter((tool) => tool.role === selectedRole) : [];

  function localizedError(error: unknown): string {
    const code = error instanceof HarnessModeEditorValidationError || error instanceof RequestError
      ? error.code
      : "request_failed";
    return ERROR_KEYS[code] ?? "requestFailed";
  }

  function toggleGate(gate: HarnessAutonomyGate, checked: boolean) {
    setAutoCross((current) => checked ? [...current, gate] : current.filter((item) => item !== gate));
  }

  function toggleNotification(notification: HarnessAutonomyNotification, checked: boolean) {
    setNotifyOn((current) => checked
      ? [...current, notification]
      : current.filter((item) => item !== notification));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setErrorKey(null);
    if (toolBindingBlocker) {
      setErrorKey(toolBindingBlocker);
      return;
    }
    setBusy("submit");
    try {
      const request = buildModeIntentRequest(
        projectId,
        {
          profile,
          plannerTool,
          plannerInvocation,
          generatorTool,
          generatorInvocation,
          evaluatorTool,
          evaluatorInvocation,
          intentExpiresAt,
          autonomyEnabled,
          autonomyExpiresAt,
          maxTokens,
          maxCostUsd,
          maxWakes,
          maxFixRounds,
          autoCross,
          notifyOn
        },
        tools,
        new Date(),
        { useToolBindings: supportsToolBindings }
      );
      const response = await fetch("/api/harness/mode-intents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request)
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new RequestError(responseErrorCode(body));
      startTransition(() => router.refresh());
    } catch (error) {
      setErrorKey(localizedError(error));
    } finally {
      setBusy(null);
    }
  }

  async function cancelIntent() {
    if (!currentIntent?.canCancel || !window.confirm(t("confirmCancel"))) return;
    setErrorKey(null);
    setBusy("delete");
    try {
      const response = await fetch("/api/harness/mode-intents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, intentId: currentIntent.intentId })
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new RequestError(responseErrorCode(body));
      startTransition(() => router.refresh());
    } catch (error) {
      setErrorKey(localizedError(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card id={MODE_EDITOR_ANCHOR} extra="scroll-mt-6 !rounded-lg border border-gray-200 !p-5 dark:border-white/10">
      <div className="flex flex-col gap-5">
        <div>
          <h3 className="text-base font-bold text-navy-700 dark:text-white">{t("title")}</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("nextPlanNotice")}</p>
        </div>

        {selectedRole ? (
          <SelectedRoleContext
            role={selectedRole}
            label={t(selectedRole)}
            capabilities={selectedRoleCapabilities}
            currentBinding={currentRoleBinding}
            pendingBinding={pendingRoleBinding}
            t={t}
          />
        ) : null}

        <div className="border-y border-gray-200 py-4 dark:border-white/10">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase text-gray-500 dark:text-gray-400">{t("pendingIntent")}</p>
              {currentIntent ? (
                <div className="mt-1 space-y-1 text-sm">
                  <p className="break-all font-mono text-navy-700 dark:text-white">{currentIntent.intentId}</p>
                  <p className="text-gray-500 dark:text-gray-400">
                    {statusT.has(currentIntent.status) ? statusT(currentIntent.status) : currentIntent.status}
                  </p>
                  <p className="break-words text-xs text-gray-400">
                    {t("issuedAt", { value: currentIntent.issuedAt })} · {t("expiresAt", { value: currentIntent.intentExpiresAt })}
                  </p>
                </div>
              ) : (
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("noPendingIntent")}</p>
              )}
            </div>
            {currentIntent?.canCancel ? (
              <button
                type="button"
                onClick={cancelIntent}
                disabled={busy !== null || refreshing}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-red-200 px-3 text-sm font-medium text-red-600 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/30 dark:hover:bg-red-500/10"
              >
                <MdDeleteOutline className="h-4 w-4" />
                {busy === "delete" ? t("canceling") : t("cancel")}
              </button>
            ) : currentIntent ? (
              <p className="max-w-xs text-xs text-gray-500 dark:text-gray-400">{t("cannotCancelStaged")}</p>
            ) : null}
          </div>
        </div>

        {blocker ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            {t(`disabled.${blocker}`, { version: requiredModeIntentAgentFeatureVersion(blocker) })}
          </p>
        ) : null}

        <form onSubmit={submit} className="space-y-5">
          <fieldset disabled={baseDisabled} className="space-y-5 disabled:opacity-70">
            <div>
              <legend className="mb-2 text-xs font-bold uppercase text-gray-500 dark:text-gray-400">{t("execution")}</legend>
              <div className="grid grid-cols-3 overflow-hidden rounded-md border border-gray-200 dark:border-white/10">
                {HARNESS_EXECUTION_PROFILES.map((item) => (
                  <button
                  key={item}
                  type="button"
                  aria-pressed={profile === item}
                    onClick={() => selectProfile(item)}
                    className={`min-h-10 px-2 py-2 text-xs font-semibold transition focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:text-sm ${
                      profile === item
                        ? "bg-brand-500 text-white"
                        : "bg-white text-gray-600 hover:bg-gray-50 dark:bg-navy-900 dark:text-gray-300 dark:hover:bg-white/5"
                    }`}
                  >
                    {t(`profile.${item}`)}
                  </button>
                ))}
              </div>
            </div>

            {profile !== "fast" ? (
              <div className="grid gap-4 lg:grid-cols-3">
                <RoleToolBinding
                  role="planner"
                  label={t("planner")}
                  tool={plannerTool}
                  invocation={plannerInvocation}
                  options={plannerOptions}
                  allowCoordinator
                  disabled={toolBindingBlocker !== null}
                  selected={selectedRole === "planner"}
                  onToolChange={(nextTool) => {
                    setPlannerTool(nextTool);
                    setPlannerInvocation(nextTool ? firstInvocation(plannerOptions, nextTool) : "");
                  }}
                  onInvocationChange={setPlannerInvocation}
                  t={t}
                />
                <RoleToolBinding
                  role="generator"
                  label={t("generator")}
                  tool={generatorTool}
                  invocation={generatorInvocation}
                  options={generatorOptions}
                  disabled={toolBindingBlocker !== null}
                  selected={selectedRole === "generator"}
                  onToolChange={(nextTool) => {
                    setGeneratorTool(nextTool);
                    setGeneratorInvocation(firstInvocation(generatorOptions, nextTool));
                  }}
                  onInvocationChange={setGeneratorInvocation}
                  t={t}
                />
                <RoleToolBinding
                  role="evaluator"
                  label={t("evaluator")}
                  tool={evaluatorTool}
                  invocation={evaluatorInvocation}
                  options={evaluatorOptions}
                  disabled={toolBindingBlocker !== null}
                  selected={selectedRole === "evaluator"}
                  onToolChange={(nextTool) => {
                    setEvaluatorTool(nextTool);
                    setEvaluatorInvocation(firstInvocation(evaluatorOptions, nextTool));
                  }}
                  onInvocationChange={setEvaluatorInvocation}
                  t={t}
                />
              </div>
            ) : null}

            {toolBindingBlocker ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                {t(`disabled.${toolBindingBlocker}`, { version: requiredModeIntentAgentFeatureVersion(toolBindingBlocker) })}
              </p>
            ) : null}

            <label className="block text-sm font-medium text-navy-700 dark:text-white">
              {t("intentExpiresAt")}
              <input type="datetime-local" value={intentExpiresAt} onChange={(event) => setIntentExpiresAt(event.target.value)} className={`${INPUT} mt-1.5`} />
            </label>

            <div className="border-t border-gray-200 pt-5 dark:border-white/10">
              <label className="flex items-center justify-between gap-4 text-sm font-medium text-navy-700 dark:text-white">
                <span>{t("autonomy")}</span>
                <Switch
                  name="autonomy"
                  role="switch"
                  aria-checked={autonomyEnabled}
                  checked={autonomyEnabled}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setAutonomyEnabled(event.target.checked)}
                  extra="focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                />
              </label>
            </div>

            {autonomyEnabled ? (
              <div className="space-y-5">
                <label className="block text-sm font-medium text-navy-700 dark:text-white">
                  {t("autonomyExpiresAt")}
                  <input type="datetime-local" value={autonomyExpiresAt} onChange={(event) => setAutonomyExpiresAt(event.target.value)} className={`${INPUT} mt-1.5`} />
                </label>

                <div className="grid gap-4 sm:grid-cols-2">
                  <NumericField label={t("maxTokens")} value={maxTokens} setValue={setMaxTokens} min={HARNESS_AUTONOMY_LIMITS.maxTokens.min} max={HARNESS_AUTONOMY_LIMITS.maxTokens.max} />
                  <NumericField label={t("maxCostUsd")} value={maxCostUsd} setValue={setMaxCostUsd} min={HARNESS_AUTONOMY_LIMITS.maxCostUsd.min} max={HARNESS_AUTONOMY_LIMITS.maxCostUsd.max} step="0.01" />
                  <NumericField label={t("maxWakes")} value={maxWakes} setValue={setMaxWakes} min={HARNESS_AUTONOMY_LIMITS.maxWakes.min} max={HARNESS_AUTONOMY_LIMITS.maxWakes.max} />
                  <NumericField label={t("maxFixRounds")} value={maxFixRounds} setValue={setMaxFixRounds} min={HARNESS_AUTONOMY_LIMITS.maxFixRounds.min} max={HARNESS_AUTONOMY_LIMITS.maxFixRounds.max} />
                </div>

                <CheckGroup label={t("autoCross")}>
                  {HARNESS_AUTONOMY_GATES.map((gate) => (
                    <CheckOption key={gate} checked={autoCross.includes(gate)} onChange={(checked) => toggleGate(gate, checked)} label={t(`gate.${gate}`)} />
                  ))}
                </CheckGroup>

                <CheckGroup label={t("notifications")}>
                  {HARNESS_AUTONOMY_NOTIFICATIONS.map((notification) => (
                    <CheckOption key={notification} checked={notifyOn.includes(notification)} onChange={(checked) => toggleNotification(notification, checked)} label={t(`notification.${notification}`)} />
                  ))}
                </CheckGroup>
              </div>
            ) : null}
          </fieldset>

          {errorKey ? <p role="alert" className="text-sm text-red-600 dark:text-red-300">{t(`errors.${errorKey}`, { version: requiredModeIntentAgentFeatureVersion(errorKey) })}</p> : null}

          <button
            type="submit"
            disabled={submitDisabled}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-brand-500 px-4 text-sm font-bold text-white transition hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <MdSend className="h-4 w-4" />
            {busy === "submit" || refreshing ? t("submitting") : t("submit")}
          </button>
        </form>
      </div>
    </Card>
  );
}

type RoleToolOption = {
  tool: string;
  label: string;
  invocation: HarnessTransport;
  capabilities: string[];
  modelFamilies: string[];
};

export type InitialNonFastBindings = {
  plannerTool: "";
  plannerInvocation: "";
  generatorTool: string;
  generatorInvocation: HarnessTransport;
  evaluatorTool: string;
  evaluatorInvocation: HarnessTransport;
};

function SelectedRoleContext({
  role,
  label,
  capabilities,
  currentBinding,
  pendingBinding,
  t
}: {
  role: HarnessModeRole;
  label: string;
  capabilities: readonly HarnessDetailToolCapability[];
  currentBinding: RoleBindingContext;
  pendingBinding: RoleBindingContext;
  t: ReturnType<typeof useTranslations>;
}) {
  const modelFamilies = [...new Set(capabilities.flatMap((capability) => capability.modelFamilies))];
  const availableCapabilities = [...new Set(capabilities.flatMap((capability) => capability.capabilities))];
  return (
    <section
      id="mode-editor-role-context"
      aria-labelledby="mode-editor-role-context-title"
      data-selected-role={role}
      className="border-y border-brand-200 bg-brand-50/50 px-3 py-4 dark:border-brand-500/30 dark:bg-brand-500/10"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase text-brand-700 dark:text-brand-200">{t("selectedRole")}</p>
          <h4 id="mode-editor-role-context-title" className="mt-1 text-sm font-bold text-navy-700 dark:text-white">
            {t("selectedRoleContext", { role: label })}
          </h4>
        </div>
        <span className="font-mono text-xs text-brand-700 dark:text-brand-200">{role}</span>
      </div>
      <dl className="mt-3 grid gap-x-5 gap-y-3 text-xs sm:grid-cols-2 xl:grid-cols-3">
        <RoleContextFact label={t("availableTools")}>
          {capabilities.length ? (
            <ul className="space-y-1.5">
              {capabilities.map((capability) => (
                <li key={`${capability.tool}\u0000${capability.invocation}`} className="flex flex-wrap items-baseline gap-x-1.5">
                  <span className="font-mono text-navy-700 dark:text-white">
                    {capability.label === capability.tool ? capability.tool : `${capability.label} (${capability.tool})`} · {capability.invocation}
                  </span>
                  <span className="text-gray-500 dark:text-gray-400">{t("candidateCount", { count: capability.agentCount })}</span>
                </li>
              ))}
            </ul>
          ) : <span className="text-gray-500 dark:text-gray-400">{t("noRoleTools")}</span>}
        </RoleContextFact>
        <RoleContextFact label={t("modelFamilies")} value={modelFamilies.join(" · ") || t("notAvailable")} />
        <RoleContextFact label={t("capabilities")} value={availableCapabilities.join(" · ") || t("notAvailable")} />
        <RoleContextFact label={t("currentBinding")}>
          <BindingSummary binding={currentBinding} unavailable={t("notAvailable")} coordinator={role === "planner" ? t("coordinator") : null} />
        </RoleContextFact>
        <RoleContextFact label={t("nextPlanBinding")}>
          <BindingSummary binding={pendingBinding} unavailable={t("notAvailable")} coordinator={role === "planner" ? t("coordinator") : null} />
        </RoleContextFact>
      </dl>
    </section>
  );
}

function RoleContextFact({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-medium text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-1 break-words text-navy-700 dark:text-white">{children ?? value}</dd>
    </div>
  );
}

function BindingSummary({ binding, unavailable, coordinator }: { binding: RoleBindingContext; unavailable: string; coordinator: string | null }) {
  if (binding === undefined) return <span className="text-gray-500 dark:text-gray-400">{unavailable}</span>;
  if (binding === null) return <span className="text-gray-500 dark:text-gray-400">{coordinator ?? unavailable}</span>;
  return (
    <span className="font-mono text-navy-700 dark:text-white">
      {binding.tool} · {binding.invocation}{binding.modelFamily ? ` · ${binding.modelFamily}` : ""}
    </span>
  );
}

function roleToolOptions(tools: readonly HarnessDetailToolCapability[], role: HarnessDetailToolCapability["role"]): RoleToolOption[] {
  const options = new Map<string, RoleToolOption>();
  for (const capability of tools) {
    if (capability.role !== role) continue;
    const option = {
      tool: capability.tool,
      label: capability.label,
      invocation: capability.invocation,
      capabilities: capability.capabilities,
      modelFamilies: capability.modelFamilies
    };
    options.set(`${option.tool}\u0000${option.invocation}`, option);
  }
  return [...options.values()].sort((left, right) =>
    `${left.tool}\u0000${left.invocation}`.localeCompare(`${right.tool}\u0000${right.invocation}`)
  );
}

function independentModelFamilies(left: RoleToolOption, right: RoleToolOption): boolean {
  return left.modelFamilies.some((generator) =>
    right.modelFamilies.some((evaluator) => generator !== evaluator)
  );
}

function transportsMatchProfile(
  profile: Exclude<HarnessExecutionProfile, "fast">,
  invocations: readonly HarnessTransport[]
): boolean {
  if (profile === "heterogeneous") {
    return !invocations.includes("a2a") && invocations.includes("local-cli");
  }
  return invocations.includes("a2a");
}

function selectedOption(
  options: readonly RoleToolOption[],
  tool: string,
  invocation: string
): RoleToolOption | null {
  return options.find((option) => option.tool === tool && option.invocation === invocation) ?? null;
}

export function initialNonFastBindingsForProfile(
  tools: readonly HarnessDetailToolCapability[],
  profile: Exclude<HarnessExecutionProfile, "fast">
): InitialNonFastBindings | null {
  const generatorOptions = roleToolOptions(tools, "generator");
  const evaluatorOptions = roleToolOptions(tools, "evaluator");
  for (const generator of generatorOptions) {
    for (const evaluator of evaluatorOptions) {
      if (
        independentModelFamilies(generator, evaluator) &&
        transportsMatchProfile(profile, [generator.invocation, evaluator.invocation])
      ) {
        return {
          plannerTool: "",
          plannerInvocation: "",
          generatorTool: generator.tool,
          generatorInvocation: generator.invocation,
          evaluatorTool: evaluator.tool,
          evaluatorInvocation: evaluator.invocation
        };
      }
    }
  }
  return null;
}

function nonFastBindingsAreSignable(
  profile: Exclude<HarnessExecutionProfile, "fast">,
  plannerOptions: readonly RoleToolOption[],
  generatorOptions: readonly RoleToolOption[],
  evaluatorOptions: readonly RoleToolOption[],
  plannerTool: string,
  plannerInvocation: string,
  generatorTool: string,
  generatorInvocation: string,
  evaluatorTool: string,
  evaluatorInvocation: string
): boolean {
  const generator = selectedOption(generatorOptions, generatorTool, generatorInvocation);
  const evaluator = selectedOption(evaluatorOptions, evaluatorTool, evaluatorInvocation);
  if (!generator || !evaluator || !independentModelFamilies(generator, evaluator)) return false;

  const planner = plannerTool || plannerInvocation
    ? selectedOption(plannerOptions, plannerTool, plannerInvocation)
    : null;
  if ((plannerTool || plannerInvocation) && !planner) return false;
  return transportsMatchProfile(profile, [
    ...(planner ? [planner.invocation] : []),
    generator.invocation,
    evaluator.invocation
  ]);
}

function firstInvocation(options: readonly RoleToolOption[], tool: string): HarnessTransport | "" {
  return options.find((option) => option.tool === tool)?.invocation ?? "";
}

function RoleToolBinding({
  role,
  label,
  tool,
  invocation,
  options,
  allowCoordinator = false,
  disabled,
  selected,
  onToolChange,
  onInvocationChange,
  t
}: {
  role: HarnessModeRole;
  label: string;
  tool: string;
  invocation: string;
  options: readonly RoleToolOption[];
  allowCoordinator?: boolean;
  disabled: boolean;
  selected: boolean;
  onToolChange: (tool: string) => void;
  onInvocationChange: (invocation: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const tools = [...new Set(options.map((option) => option.tool))].map((candidateTool) => {
    const selectedInvocation = candidateTool === tool ? invocation : firstInvocation(options, candidateTool);
    const fallback = options.find((option) => option.tool === candidateTool);
    return {
      tool: candidateTool,
      label: toolCatalogLabelForInvocation(options, candidateTool, selectedInvocation as HarnessTransport)
        ?? fallback?.label
        ?? candidateTool
    };
  });
  const invocations = options.filter((option) => option.tool === tool).map((option) => option.invocation);
  const coordinatorSelected = allowCoordinator && !tool;
  const toolId = `mode-binding-${role}-tool`;
  const invocationId = `mode-binding-${role}-invocation`;
  return (
    <fieldset
      id={modeEditorFocusRegion(role)}
      tabIndex={selected ? -1 : undefined}
      data-selected-role={selected ? role : undefined}
      className={`space-y-2 ${selected ? "rounded-md border border-brand-300 bg-brand-50/50 p-3 dark:border-brand-500/40 dark:bg-brand-500/10" : ""}`}
    >
      <legend className="text-sm font-medium text-navy-700 dark:text-white">{label}</legend>
      <label htmlFor={toolId} className="block text-xs font-medium text-gray-500 dark:text-gray-400">
        {t("tool")}
        <select id={toolId} aria-label={`${label}: ${t("tool")}`} aria-describedby={selected ? "mode-editor-role-context" : undefined} value={tool} disabled={disabled} onChange={(event) => onToolChange(event.target.value)} className={`${INPUT} mt-1`}>
          <option value="">{allowCoordinator ? t("coordinator") : t("selectTool")}</option>
          {tools.map((option) => (
            <option key={option.tool} value={option.tool}>
              {option.label === option.tool ? option.label : `${option.label} (${option.tool})`}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={invocationId} className="block text-xs font-medium text-gray-500 dark:text-gray-400">
        {t("invocation")}
        <select id={invocationId} aria-label={`${label}: ${t("invocation")}`} aria-describedby={selected ? "mode-editor-role-context" : undefined} value={invocation} disabled={disabled || coordinatorSelected} onChange={(event) => onInvocationChange(event.target.value)} className={`${INPUT} mt-1`}>
          <option value="">{coordinatorSelected ? t("coordinator") : t("selectInvocation")}</option>
          {invocations.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
    </fieldset>
  );
}

function NumericField({
  label,
  value,
  setValue,
  min,
  max,
  step = "1"
}: {
  label: string;
  value: string;
  setValue: (value: string) => void;
  min: number;
  max: number;
  step?: string;
}) {
  return (
    <label className="text-sm font-medium text-navy-700 dark:text-white">
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        inputMode={step === "0.01" ? "decimal" : "numeric"}
        onChange={(event) => setValue(event.target.value)}
        className={`${INPUT} mt-1.5`}
      />
    </label>
  );
}

function CheckGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-navy-700 dark:text-white">{label}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">{children}</div>
    </fieldset>
  );
}

function CheckOption({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
      <Checkbox
        checked={checked}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.checked)}
        extra="focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      />
      <span>{label}</span>
    </label>
  );
}
