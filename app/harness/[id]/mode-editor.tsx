"use client";

import { useState, useTransition, type FormEvent } from "react";
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
  type HarnessDetailAgent,
  type HarnessModeIssuanceBlocker
} from "@/shared/harness-detail";
import {
  HARNESS_AUTONOMY_GATES,
  HARNESS_AUTONOMY_NOTIFICATIONS,
  HARNESS_EXECUTION_PROFILES,
  type HarnessAutonomyGate,
  type HarnessAutonomyNotification,
  type HarnessExecutionProfile
} from "@/shared/harness-mode-intent";

type PendingIntent = {
  intentId: string;
  status: string;
  issuedAt: string;
  intentExpiresAt: string;
  canCancel: boolean;
};

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
  invalid_project_head: "headNotFull",
  invalid_mode_snapshot: "agentSnapshotUnavailable",
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
  agents,
  blocker,
  currentIntent
}: {
  projectId: string;
  agents: HarnessDetailAgent[];
  blocker: HarnessModeIssuanceBlocker | null;
  currentIntent: PendingIntent | null;
}) {
  const t = useTranslations("harness.editor");
  const statusT = useTranslations("harness.status.intent");
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const generators = agents.filter((agent) => agent.roles.includes("generator"));
  const evaluators = agents.filter((agent) => agent.roles.includes("evaluator"));
  const [profile, setProfile] = useState<HarnessExecutionProfile>("fast");
  const [generatorId, setGeneratorId] = useState(generators[0]?.id ?? "");
  const [evaluatorId, setEvaluatorId] = useState(evaluators.find((agent) => agent.id !== generators[0]?.id)?.id ?? evaluators[0]?.id ?? "");
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

  const disabled = blocker !== null || busy !== null || refreshing;

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
    setBusy("submit");
    try {
      const request = buildModeIntentRequest(
        projectId,
        {
          profile,
          generatorId,
          evaluatorId,
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
        agents,
        new Date()
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
    <Card extra="!rounded-lg border border-gray-200 !p-5 dark:border-white/10">
      <div className="flex flex-col gap-5">
        <div>
          <h3 className="text-base font-bold text-navy-700 dark:text-white">{t("title")}</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("nextPlanNotice")}</p>
        </div>

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
            {t(`disabled.${blocker}`)}
          </p>
        ) : null}

        <form onSubmit={submit} className="space-y-5">
          <fieldset disabled={disabled} className="space-y-5 disabled:opacity-70">
            <div>
              <legend className="mb-2 text-xs font-bold uppercase text-gray-500 dark:text-gray-400">{t("execution")}</legend>
              <div className="grid grid-cols-3 overflow-hidden rounded-md border border-gray-200 dark:border-white/10">
                {HARNESS_EXECUTION_PROFILES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={profile === item}
                    onClick={() => setProfile(item)}
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
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-navy-700 dark:text-white">
                  {t("generator")}
                  <select value={generatorId} onChange={(event) => setGeneratorId(event.target.value)} className={`${INPUT} mt-1.5`}>
                    <option value="">{t("selectAgent")}</option>
                    {generators.map((agent) => <option key={agent.id} value={agent.id}>{agent.id} · {agent.modelFamily ?? "?"} · {agent.transport}</option>)}
                  </select>
                </label>
                <label className="text-sm font-medium text-navy-700 dark:text-white">
                  {t("evaluator")}
                  <select value={evaluatorId} onChange={(event) => setEvaluatorId(event.target.value)} className={`${INPUT} mt-1.5`}>
                    <option value="">{t("selectAgent")}</option>
                    {evaluators.map((agent) => <option key={agent.id} value={agent.id}>{agent.id} · {agent.modelFamily ?? "?"} · {agent.transport}</option>)}
                  </select>
                </label>
              </div>
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

          {errorKey ? <p role="alert" className="text-sm text-red-600 dark:text-red-300">{t(`errors.${errorKey}`)}</p> : null}

          <button
            type="submit"
            disabled={disabled}
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
