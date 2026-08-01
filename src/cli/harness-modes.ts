import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readDispatchToolCatalog, readDispatchToolIntegrations } from "./harness-tool-catalog";
import type { HarnessToolCatalogEntry, HarnessToolIntegration } from "@/shared/harness-tool-catalog";
import {
  HARNESS_MODE_ROLES,
  HARNESS_TRANSPORTS,
  type HarnessModeRole,
  type HarnessTransport
} from "@/shared/harness-mode-intent";
import { readPendingModeDefaults, type PendingModeDefaultsSummary } from "./harness-mode-intents";

/**
 * harness 项目的**模式指纹** —— 「这个项目现在到底跑在什么模式下」的只读快照。
 *
 * 为什么需要：harness 现在有六个正交维度（执行形态 / 手动 vs 自主 / dispatch / 控制台通道 /
 * 闸门校验模式 / 框架版本），每个维度的开关都散在不同文件里（`.agents-registry.json`、
 * `autonomy-policy.json`、`.claude/console/console.pub`、`harness.lock`…）。人要回答
 * 「minigame 现在是什么模式」得翻五个文件——控制台存在的意义就是把这件事变成看一眼。
 *
 * 🔴 这是**只读镜像**，不是判定。真相永远在机器上的那些文件里：
 * - 这里的 policy 合法性是轻量解析，权威判定仍是 `validate-autonomy-policy.sh`
 * - 这里的 family 互斥是复算，权威守门仍是 `validate-dispatch.sh assignments` 那个 hook
 * 镜像算错只会让控制台显示错，绝不会让机器少一道校验。
 */

export type FrameworkInfo = {
  version: string | null;
  commit: string | null;
  adopted: boolean;
  managedCount: number;
  drift: { ok: number; modified: number; missing: number; customized: number };
  scanned: boolean;
};

export type ModeSnapshot = {
  framework: FrameworkInfo | null;
  execution: "fast" | "heterogeneous" | "slow" | "unknown";
  current: {
    profile: "heterogeneous" | "slow";
    roleBindings: CurrentRoleBindings;
  } | null;
  autonomy: { enabled: boolean; policyValid: boolean | null; authorizedBy: string | null; expiresAt: string | null; status: string | null };
  dispatch: {
    enabled: boolean;
    assignments: DispatchAssignments;
    agents: DispatchAgent[];
    integrations: DispatchIntegration[];
    toolCatalog: DispatchToolCapability[];
    familyExclusive: boolean | null;
    issues: string[];
  };
  gate: { pubInstalled: boolean; guardMode: "signature" | "head-compare"; pendingGateId: string | null };
  machinery: { denyListMerged: boolean | null; hooks: string[]; missing: string[] };
  pendingDefaults: PendingModeDefaultsSummary | null;
};

/** A null Planner assignment is the persisted Coordinator route in v2. */
export type DispatchAssignments = Record<string, string | null>;

export type DispatchAgent = {
  id: string;
  roles: string[];
  transport: string;
  modelFamily: string | null;
  adapter: string | null;
  sandboxed: boolean;
  capabilities: string[];
};

export type DispatchToolCapability = HarnessToolCatalogEntry;
export type DispatchIntegration = HarnessToolIntegration;

type CurrentRoleBinding = { tool: string; invocation: HarnessTransport; modelFamily: string };
type CurrentRoleBindings = {
  planner: CurrentRoleBinding | null;
  generator: CurrentRoleBinding;
  evaluator: CurrentRoleBinding;
};

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

// ── 框架版本与本地漂移 ───────────────────────────────────────────────────────
// 只算**本地**漂移（工作区 vs lock）。「落后于新版」需要上游源树，agent 手上没有——
// 与其猜，不如只报本地事实，版本比较交给控制台按版本号做。
type Lock = {
  framework?: { version?: string; commit?: string };
  managed?: Record<string, { sha256?: string; upstream?: string }>;
};

const DRIFT_SCAN_TTL_MS = 10 * 60 * 1000;
const driftCache = new Map<string, { at: number; lockMtimeMs: number; info: FrameworkInfo }>();

export function readFramework(repoPath: string, now: number = Date.now()): FrameworkInfo | null {
  const lockPath = join(repoPath, "harness.lock");
  const config = readJson<{ framework?: { version?: string; commit?: string; adopted?: boolean } }>(
    join(repoPath, "harness.json")
  );
  const lock = readJson<Lock>(lockPath);
  if (!lock && !config) return null;

  const base: FrameworkInfo = {
    version: lock?.framework?.version ?? config?.framework?.version ?? null,
    commit: lock?.framework?.commit ?? config?.framework?.commit ?? null,
    adopted: Boolean(config?.framework?.adopted),
    managedCount: Object.keys(lock?.managed ?? {}).length,
    drift: { ok: 0, modified: 0, missing: 0, customized: 0 },
    scanned: false
  };
  if (!lock?.managed) return base;

  // 哈希整棵受管清单不便宜（每项目 ~120 个文件），而模式画像不需要秒级新鲜度。
  // 缓存 10 分钟，且 lock 一变就立即失效（升级/adopt 后要马上看到新数字）。
  let lockMtimeMs = 0;
  try {
    lockMtimeMs = statSync(lockPath).mtimeMs;
  } catch {
    /* 读不到 mtime 就当它变了，重新扫 */
  }
  const cached = driftCache.get(repoPath);
  if (cached && cached.lockMtimeMs === lockMtimeMs && now - cached.at < DRIFT_SCAN_TTL_MS) {
    return cached.info;
  }

  const drift = { ok: 0, modified: 0, missing: 0, customized: 0 };
  for (const [rel, meta] of Object.entries(lock.managed)) {
    const path = join(repoPath, rel);
    if (!existsSync(path)) {
      drift.missing += 1;
      continue;
    }
    let sha: string;
    try {
      sha = createHash("sha256").update(readFileSync(path)).digest("hex");
    } catch {
      drift.missing += 1;
      continue;
    }
    const upstream = meta.upstream ?? meta.sha256;
    if (sha !== meta.sha256) drift.modified += 1;          // 上次对齐之后又改了
    else if (meta.sha256 !== upstream) drift.customized += 1; // 已登记在册的本地定制
    else drift.ok += 1;
  }
  const info = { ...base, drift, scanned: true };
  driftCache.set(repoPath, { at: now, lockMtimeMs, info });
  return info;
}

// ── dispatch ────────────────────────────────────────────────────────────────
type Registry = {
  version?: string;
  agents?: Array<{
    id?: string;
    roles?: string[];
    transport?: string;
    model_family?: string;
    adapter?: string;
    sandbox?: unknown;
    capabilities?: unknown;
  }>;
};

function safeCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(item))
        .slice(0, 32)
    )
  ];
}

export function readDispatch(repoPath: string, assignments: DispatchAssignments): ModeSnapshot["dispatch"] {
  const registryPath = join(repoPath, ".agents-registry.json");
  const registryPresent = existsSync(registryPath);
  const registry = readJson<Registry>(registryPath);
  const legacyAgents = Array.isArray(registry?.agents)
    ? registry.agents
    : [];
  const catalog = readDispatchToolCatalog(repoPath);
  const integrationCatalog = readDispatchToolIntegrations(repoPath);
  const enabled = legacyAgents.length > 0 || integrationCatalog.issue === null;
  if (!enabled) {
    const issues = [...new Set([catalog.issue, integrationCatalog.issue].filter(
      (issue): issue is string => typeof issue === "string"
    ))];
    // A present but invalid registry is a configuration failure, not the same
    // state as a project that has never opted into dispatch.
    if (registryPresent && issues.length === 0) issues.push("dispatch tool catalog is unavailable");
    return {
      enabled: false,
      assignments: {},
      agents: [],
      integrations: [],
      toolCatalog: [],
      familyExclusive: null,
      issues
    };
  }

  const agents: DispatchAgent[] = legacyAgents.map((a) => ({
    id: a.id ?? "",
    roles: a.roles ?? [],
    transport: a.transport ?? "unknown",
    modelFamily: a.model_family ?? null,
    adapter: a.adapter ?? null,
    sandboxed: Boolean(a.sandbox),
    capabilities: safeCapabilities(a.capabilities)
  }));
  const byId = new Map(agents.map((a) => [a.id, a]));
  const issues: string[] = [];

  for (const [role, id] of Object.entries(assignments)) {
    if (id === null) {
      if (role !== "planner") issues.push(`role_assignments.${role}=null 非法`);
      continue;
    }
    if (legacyAgents.length > 0 && !byId.has(id)) issues.push(`role_assignments.${role}=${id} 不在注册表里`);
  }
  // 独立性铁则第 5 条：generator 与 evaluator 的 model_family 必须不同。
  // 这里只是复算给人看；机器上的 PostToolUse hook 才是那道拦得住写入的门。
  const g = assignments.generator ? byId.get(assignments.generator) : undefined;
  const e = assignments.evaluator ? byId.get(assignments.evaluator) : undefined;
  let familyExclusive: boolean | null = null;
  if (g && e) {
    familyExclusive = Boolean(g.modelFamily && e.modelFamily && g.modelFamily !== e.modelFamily);
    if (!familyExclusive) issues.push(`generator 与 evaluator 同为 ${g.modelFamily ?? "?"} family —— 独立性形同虚设`);
  }
  // local-cli 必须配专用空 HOME，否则 env 白名单会被登录 shell 还原（dispatch-mode §5.1）
  for (const a of agents) {
    if (a.transport === "local-cli" && !a.sandboxed) issues.push(`${a.id} 是 local-cli 却没配 sandbox —— env 白名单形同虚设`);
  }
  if (catalog.issue) issues.push(catalog.issue);
  if (integrationCatalog.issue && integrationCatalog.issue !== catalog.issue) issues.push(integrationCatalog.issue);
  return {
    enabled: true,
    assignments,
    agents,
    integrations: integrationCatalog.integrations,
    toolCatalog: catalog.entries,
    familyExclusive,
    issues
  };
}

// ── 机件在位 ─────────────────────────────────────────────────────────────────
type Settings = {
  hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
  permissions?: { deny?: string[] };
};

export function readMachinery(repoPath: string): ModeSnapshot["machinery"] {
  const settings = readJson<Settings>(join(repoPath, ".claude", "settings.json"));
  const commands: string[] = [];
  for (const groups of Object.values(settings?.hooks ?? {})) {
    for (const group of groups) for (const h of group.hooks ?? []) if (h.command) commands.push(h.command);
  }
  const EXPECTED: Array<[string, string]> = [
    ["session-start", "session-start.sh"],
    ["state-json", "validate-state-json.sh"],
    ["dispatch", "validate-dispatch.sh"],
    ["pending-gate", "validate-pending-gate.sh"]
  ];
  const hooks: string[] = [];
  const missing: string[] = [];
  for (const [label, needle] of EXPECTED) {
    (commands.some((c) => c.includes(needle)) ? hooks : missing).push(label);
  }

  // 自主模式的 deny-list 是否已合入：autodrive 模板列出的每一条都要在 settings 里
  const autodrive = readJson<{ permissions?: { deny?: string[] } }>(
    join(repoPath, ".claude", "autonomous", "settings.autodrive.json")
  );
  let denyListMerged: boolean | null = null;
  if (autodrive?.permissions?.deny?.length) {
    const have = new Set(settings?.permissions?.deny ?? []);
    denyListMerged = autodrive.permissions.deny.every((rule) => have.has(rule));
  }
  return { denyListMerged, hooks, missing };
}

// ── 汇总 ─────────────────────────────────────────────────────────────────────
type Progress = {
  role_assignments?: DispatchAssignments;
  mode_intent?: unknown;
  autonomy?: { status?: string | null };
  pending_gate?: { id?: string } | null;
};

const CURRENT_TOOL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CURRENT_TRANSPORTS = new Set<string>(HARNESS_TRANSPORTS);

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedCurrentText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max && !/[\u0000-\u001f\u007f]/.test(normalized) ? normalized : null;
}

/**
 * v2 resolution is the persisted audit fact after the framework maps a signed
 * tool binding to local agent ids. Keep the ids only for consistency checking;
 * the reported current mode remains tool-centric.
 */
function currentResolvedMode(
  value: unknown,
  assignments: DispatchAssignments
): ModeSnapshot["current"] {
  const intent = plainRecord(value);
  const resolution = plainRecord(intent?.resolution);
  if (!resolution || Object.keys(resolution).length !== HARNESS_MODE_ROLES.length) return null;

  const roleBindings = {} as NonNullable<ModeSnapshot["current"]>["roleBindings"];
  for (const role of HARNESS_MODE_ROLES) {
    if (role === "planner" && resolution[role] === null) {
      if (assignments.planner !== null) return null;
      roleBindings.planner = null;
      continue;
    }
    const entry = plainRecord(resolution[role]);
    if (!entry || Object.keys(entry).sort().join("\u0000") !== "agent_id\u0000invocation\u0000model_family\u0000priority\u0000tool") return null;
    const agentId = boundedCurrentText(entry.agent_id, 128);
    const tool = boundedCurrentText(entry.tool, 64);
    const invocation = boundedCurrentText(entry.invocation, 32);
    const modelFamily = boundedCurrentText(entry.model_family, 128);
    if (
      !agentId ||
      assignments[role] !== agentId ||
      !tool ||
      !CURRENT_TOOL_ID.test(tool) ||
      !invocation ||
      !CURRENT_TRANSPORTS.has(invocation) ||
      !modelFamily ||
      typeof entry.priority !== "number" ||
      !Number.isSafeInteger(entry.priority) ||
      entry.priority < 0
    ) return null;
    roleBindings[role] = { tool, invocation: invocation as HarnessTransport, modelFamily };
  }

  const invocations = HARNESS_MODE_ROLES.flatMap((role) => {
    const binding = roleBindings[role];
    return binding === null ? [] : [binding.invocation];
  });
  if (invocations.includes("a2a")) return { profile: "slow", roleBindings };
  return invocations.some((invocation) => invocation === "local-cli" || invocation === "subagent")
    ? { profile: "heterogeneous", roleBindings }
    : null;
}

export function buildModeSnapshot(repoPath: string, now: number = Date.now()): ModeSnapshot {
  const progress = readJson<Progress>(join(repoPath, "progress.json")) ?? {};
  const assignments = progress.role_assignments ?? {};
  const dispatch = readDispatch(repoPath, assignments);
  const current = currentResolvedMode(progress.mode_intent, assignments);
  if (current) {
    dispatch.familyExclusive = current.roleBindings.generator.modelFamily !== current.roleBindings.evaluator.modelFamily;
    if (!dispatch.familyExclusive) {
      dispatch.issues.push(
        `generator 与 evaluator 同为 ${current.roleBindings.generator.modelFamily} family —— 独立性形同虚设`
      );
    }
  }

  // 已解析的 v2 binding 是当前配置的权威审计事实。旧项目没有它时才从
  // role_assignments 回退推断；只要含 A2A，慢车道优先于 local-cli。
  let execution: ModeSnapshot["execution"] = current?.profile ?? "fast";
  if (!current && dispatch.enabled) {
    const byId = new Map(dispatch.agents.map((a) => [a.id, a]));
    const transports = Object.values(assignments)
      .map((id) => typeof id === "string" ? byId.get(id)?.transport : undefined)
      .filter(Boolean) as string[];
    if (transports.some((t) => t === "a2a")) execution = "slow";
    else if (transports.some((transport) => transport === "local-cli" || transport === "subagent")) execution = "heterogeneous";
  }

  const policy = readJson<{ authorized_by?: string; expires_at?: string }>(join(repoPath, "autonomy-policy.json"));
  const expired = policy?.expires_at ? new Date(policy.expires_at).getTime() < now : false;

  const pubInstalled = existsSync(join(repoPath, ".claude", "console", "console.pub"));

  return {
    framework: readFramework(repoPath, now),
    execution,
    current,
    autonomy: {
      enabled: Boolean(policy),
      // 轻量判据：有 authorized_by=user 且未过期。权威判定是 validate-autonomy-policy.sh
      policyValid: policy ? policy.authorized_by === "user" && !expired : null,
      authorizedBy: policy?.authorized_by ?? null,
      expiresAt: policy?.expires_at ?? null,
      status: progress.autonomy?.status ?? null
    },
    dispatch,
    gate: {
      pubInstalled,
      guardMode: pubInstalled ? "signature" : "head-compare",
      pendingGateId: progress.pending_gate?.id ?? null
    },
    machinery: readMachinery(repoPath),
    pendingDefaults: readPendingModeDefaults(repoPath, new Date(now))
  };
}
