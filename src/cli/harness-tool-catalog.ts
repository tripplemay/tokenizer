import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HARNESS_MODE_ROLES,
  HARNESS_TRANSPORTS,
  type HarnessModeRole,
  type HarnessTransport
} from "@/shared/harness-mode-intent";
import type { HarnessToolCatalogEntry } from "@/shared/harness-tool-catalog";

type UnknownRecord = Record<string, unknown>;

const TOOL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_CAPABILITY = /^[A-Za-z0-9._-]{1,64}$/;
const POSIX_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TRANSPORTS = new Set<string>(HARNESS_TRANSPORTS);
const ROLES = new Set<string>(HARNESS_MODE_ROLES);
const PROTECTED_ENV_KEYS = new Set([
  "BASH_ENV", "CDPATH", "ENV", "HOME", "IFS", "NODE_OPTIONS", "NODE_PATH", "PATH",
  "PYTHONHOME", "PYTHONPATH", "PYTHONSTARTUP", "SHELL", "ZDOTDIR", "ZSH_ENV", "GIT_DIR",
  "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"
]);
// Keep this in lockstep with templates/claude/dispatch/dispatch_common.py.
// Any GIT_ variable can change the coordinator's non-interactive or repository
// safety contract, not only the GIT_CONFIG_ subset.
const PROTECTED_ENV_PREFIXES = ["DYLD_", "GIT_", "HARNESS_", "LD_"];
const A2A_BEARER_ENV_PREFIX = "REMOTE_A2A_";
const MAX_REGISTRY_BYTES = 512 * 1024;
const MAX_ADAPTER_BYTES = 128 * 1024;
const REGISTRY_FIELDS = new Set(["_comment", "version", "agents"]);
const DESCRIPTOR_FIELDS = new Set([
  "id", "tool", "priority", "roles", "transport", "model_family", "adapter", "endpoint", "agent_type",
  "capabilities", "constraints", "sandbox", "timeout_s", "auth", "notes"
]);
const ADAPTER_FIELDS = new Set([
  "name", "tool", "display_name", "model_family", "envelope_delivery", "argv", "artifact_relpath",
  "env_allowlist_extra", "_verified"
]);

export type ToolCatalogReadResult = {
  entries: HarnessToolCatalogEntry[];
  issue: string | null;
};

type CatalogCandidate = {
  id: string;
  roles: HarnessModeRole[];
  tool: string;
  label: string;
  invocation: HarnessTransport;
  modelFamily: string;
  priority: number;
  capabilities: string[];
};

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function safeText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

/** Match the dispatch sandbox boundary: adapters cannot override process controls. */
function externalEnvironmentKey(value: unknown): string | null {
  if (typeof value !== "string" || !POSIX_ENV_KEY.test(value)) return null;
  if (PROTECTED_ENV_KEYS.has(value) || PROTECTED_ENV_PREFIXES.some((prefix) => value.startsWith(prefix))) return null;
  return value;
}

/** An A2A descriptor may forward only a dedicated remote-token variable. */
function a2aBearerEnvironmentKey(value: unknown): string | null {
  const key = externalEnvironmentKey(value);
  return key && key.startsWith(A2A_BEARER_ENV_PREFIX) && key.length > A2A_BEARER_ENV_PREFIX.length
    ? key
    : null;
}

function validExternalEnvironmentAllowlist(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!Array.isArray(value) || value.length > 128) return false;
  const keys = new Set<string>();
  for (const item of value) {
    const key = externalEnvironmentKey(item);
    if (!key || keys.has(key)) return false;
    keys.add(key);
  }
  return true;
}

function validExternalEnvironmentSet(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  const envSet = record(value);
  if (!envSet || Object.keys(envSet).length > 128) return false;
  return Object.entries(envSet).every(([key, item]) => externalEnvironmentKey(key) !== null && safeText(item, 4_096) !== null);
}

function toolId(value: unknown): string | null {
  const valueText = safeText(value, 64);
  return valueText && TOOL_ID.test(valueText) ? valueText : null;
}

function onlyKnownKeys(value: UnknownRecord, allowed: ReadonlySet<string>, allowMetadata = false): boolean {
  return Object.keys(value).every((key) => allowed.has(key) || (allowMetadata && key.startsWith("_")));
}

function parseJsonWithUniqueKeys(raw: string): unknown | null {
  let index = 0;

  function whitespace() {
    while (/\s/.test(raw[index] ?? "")) index += 1;
  }

  function stringToken(): string {
    if (raw[index] !== '"') throw new Error("expected string");
    const start = index;
    index += 1;
    while (index < raw.length) {
      const char = raw[index++];
      if (char === "\\") {
        if (index >= raw.length) throw new Error("unterminated escape");
        index += 1;
        continue;
      }
      if (char === '"') return JSON.parse(raw.slice(start, index)) as string;
      if (char.charCodeAt(0) < 0x20) throw new Error("control character");
    }
    throw new Error("unterminated string");
  }

  function primitive(): void {
    const start = index;
    while (index < raw.length && !/[\s,}\]]/.test(raw[index])) index += 1;
    if (start === index) throw new Error("missing primitive");
    JSON.parse(raw.slice(start, index));
  }

  function value(depth: number): void {
    if (depth > 64) throw new Error("too deep");
    whitespace();
    if (raw[index] === "{") {
      index += 1;
      whitespace();
      const keys = new Set<string>();
      if (raw[index] === "}") {
        index += 1;
        return;
      }
      while (true) {
        whitespace();
        const key = stringToken();
        if (keys.has(key)) throw new Error("duplicate key");
        keys.add(key);
        whitespace();
        if (raw[index++] !== ":") throw new Error("missing colon");
        value(depth + 1);
        whitespace();
        const separator = raw[index++];
        if (separator === "}") return;
        if (separator !== ",") throw new Error("missing object separator");
      }
    }
    if (raw[index] === "[") {
      index += 1;
      whitespace();
      if (raw[index] === "]") {
        index += 1;
        return;
      }
      while (true) {
        value(depth + 1);
        whitespace();
        const separator = raw[index++];
        if (separator === "]") return;
        if (separator !== ",") throw new Error("missing array separator");
      }
    }
    if (raw[index] === '"') {
      stringToken();
      return;
    }
    primitive();
  }

  try {
    value(0);
    whitespace();
    return index === raw.length ? JSON.parse(raw) as unknown : null;
  } catch {
    return null;
  }
}

/** Read only regular in-repository files; a registry must not redirect catalog reads through symlinks. */
function regularFileUnder(repoPath: string, relativePath: string, maxBytes: number): string | null {
  try {
    const root = lstatSync(repoPath);
    if (!root.isDirectory() || root.isSymbolicLink()) return null;

    let current = repoPath;
    const parts = relativePath.split("/");
    for (const [index, part] of parts.entries()) {
      current = join(current, part);
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) return null;
      if (index === parts.length - 1) return stat.isFile() && stat.size <= maxBytes ? current : null;
      if (!stat.isDirectory()) return null;
    }
  } catch {
    return null;
  }
  return null;
}

function readJsonUnder(repoPath: string, relativePath: string, maxBytes: number): unknown | null {
  const path = regularFileUnder(repoPath, relativePath, maxBytes);
  if (!path) return null;
  try {
    return parseJsonWithUniqueKeys(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function roleList(value: unknown): HarnessModeRole[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > HARNESS_MODE_ROLES.length) return null;
  const roles: HarnessModeRole[] = [];
  for (const role of value) {
    if (typeof role !== "string" || !ROLES.has(role) || roles.includes(role as HarnessModeRole)) return null;
    roles.push(role as HarnessModeRole);
  }
  return roles;
}

function capabilities(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 64) return null;
  const parsed = new Set<string>();
  for (const capability of value) {
    const item = safeText(capability, 64);
    if (!item || !SAFE_CAPABILITY.test(item)) return null;
    parsed.add(item);
  }
  return [...parsed].sort((left, right) => left.localeCompare(right));
}

function priority(value: unknown): number | null {
  if (value === undefined || value === null) return 1_000;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function validTimeout(value: unknown): boolean {
  return value === undefined || value === null || (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 60 && value <= 86_400
  );
}

function validConstraints(value: unknown, roles: readonly HarnessModeRole[], invocation: HarnessTransport): boolean {
  const localGenerator = invocation === "local-cli" && roles.includes("generator");
  if (value === undefined || value === null) return !localGenerator;
  const constraints = record(value);
  if (!constraints || !onlyKnownKeys(constraints, new Set(["l2", "write_src", "push"]))) return false;
  for (const key of ["l2", "write_src", "push"] as const) {
    if (constraints[key] !== undefined && typeof constraints[key] !== "boolean") return false;
  }
  if (roles.includes("evaluator") && constraints.write_src === true) return false;
  if (roles.includes("planner") && (constraints.write_src === true || constraints.push === true)) return false;
  // A local CLI Generator is the only external role that may return source
  // changes. It must state all three controls explicitly; defaults are not a
  // safe basis for admitting an independently-running implementation tool.
  if (localGenerator) {
    return constraints.l2 === false && constraints.write_src === true && constraints.push === false;
  }
  return invocation === "subagent" || constraints.push !== true;
}

/** Keep catalog eligibility aligned with sandbox-profile.sh before it expands `~`. */
function validSandboxHome(value: unknown): boolean {
  const homeDir = safeText(value, 2_048);
  return homeDir !== null && (homeDir.startsWith("/") || homeDir.startsWith("~"));
}

function validSandbox(value: unknown, requireHome: boolean): boolean {
  if (value === undefined) return !requireHome;
  const sandbox = record(value);
  if (!sandbox || !onlyKnownKeys(sandbox, new Set(["home_dir", "env_allow", "env_set"]))) return false;
  if (requireHome && !validSandboxHome(sandbox.home_dir)) return false;
  if (sandbox.home_dir !== undefined && !validSandboxHome(sandbox.home_dir)) return false;
  return validExternalEnvironmentAllowlist(sandbox.env_allow) && validExternalEnvironmentSet(sandbox.env_set);
}

function validAuth(value: unknown): boolean {
  if (value === undefined) return true;
  const auth = record(value);
  if (!auth || !onlyKnownKeys(auth, new Set(["type", "env"]))) return false;
  if (auth.type === "none") return Object.keys(auth).length === 1;
  return auth.type === "bearer" &&
    Object.keys(auth).length === 2 &&
    a2aBearerEnvironmentKey(auth.env) !== null;
}

function adapterCatalogInfo(
  repoPath: string,
  adapterName: string,
  descriptor: UnknownRecord,
  modelFamily: string
): { tool: string; label: string } | null {
  const adapter = record(readJsonUnder(
    repoPath,
    `.claude/dispatch/transports/adapters/${adapterName}.json`,
    MAX_ADAPTER_BYTES
  ));
  if (!adapter || !onlyKnownKeys(adapter, ADAPTER_FIELDS, true) || toolId(adapter.name) !== adapterName || adapter._verified !== true) return null;

  const adapterDeclaresTool = adapter.tool !== undefined;
  const adapterTool = toolId(adapterDeclaresTool ? adapter.tool : adapterName);
  const descriptorTool = descriptor.tool === undefined ? null : toolId(descriptor.tool);
  if (!adapterTool || (descriptor.tool !== undefined && !descriptorTool)) return null;
  if (adapterDeclaresTool && descriptorTool && descriptorTool !== adapterTool) return null;
  if (safeText(adapter.model_family, 128) !== modelFamily) return null;
  if (
    !Array.isArray(adapter.argv) ||
    adapter.argv.length < 1 ||
    adapter.argv.length > 64 ||
    adapter.argv.some((item) => safeText(item, 1_024) === null) ||
    !validExternalEnvironmentAllowlist(adapter.env_allowlist_extra) ||
    (adapter.envelope_delivery !== "stdin" &&
      adapter.envelope_delivery !== "argv" &&
      adapter.envelope_delivery !== "env")
  ) return null;

  const tool = descriptorTool ?? adapterTool;
  const label = adapter.display_name === undefined ? tool : safeText(adapter.display_name, 128);
  return label ? { tool, label } : null;
}

function candidateFromDescriptor(repoPath: string, value: unknown, seenIds: Set<string>): CatalogCandidate | null {
  const descriptor = record(value);
  const id = safeText(descriptor?.id, 128);
  const roles = roleList(descriptor?.roles);
  const invocation = typeof descriptor?.transport === "string" && TRANSPORTS.has(descriptor.transport)
    ? descriptor.transport as HarnessTransport
    : null;
  const modelFamily = safeText(descriptor?.model_family, 128);
  if (!descriptor || !onlyKnownKeys(descriptor, DESCRIPTOR_FIELDS) || !id || !AGENT_ID.test(id) || seenIds.has(id) || !roles || !invocation || !modelFamily) return null;
  if (
    !validTimeout(descriptor.timeout_s) ||
    !validConstraints(descriptor.constraints, roles, invocation) ||
    !validSandbox(descriptor.sandbox, invocation === "local-cli") ||
    !validAuth(descriptor.auth) ||
    (invocation !== "a2a" && descriptor.auth !== undefined) ||
    (descriptor.notes !== undefined && typeof descriptor.notes !== "string")
  ) return null;

  if (invocation === "a2a") {
    if (roles.includes("generator") || !safeText(descriptor.endpoint, 2_048)) return null;
  }
  if (invocation === "subagent") {
    if (!safeText(descriptor.agent_type, 128)) return null;
    if (roles.includes("planner") && (descriptor.agent_type !== "planner-proposal" || roles.length !== 1)) return null;
  }
  if (descriptor.adapter !== undefined && !toolId(descriptor.adapter)) return null;
  if (descriptor.endpoint !== undefined && !safeText(descriptor.endpoint, 2_048)) return null;
  if (descriptor.agent_type !== undefined && !safeText(descriptor.agent_type, 128)) return null;

  let canonical: { tool: string; label: string } | null;
  if (invocation === "local-cli") {
    const adapterName = toolId(descriptor.adapter);
    if (!adapterName) return null;
    canonical = adapterCatalogInfo(repoPath, adapterName, descriptor, modelFamily);
  } else if (descriptor.tool !== undefined) {
    const tool = toolId(descriptor.tool);
    canonical = tool ? { tool, label: tool } : null;
  } else if (invocation === "subagent") {
    canonical = { tool: "claude-code", label: "claude-code" };
  } else {
    const tool = toolId(modelFamily);
    canonical = tool ? { tool, label: modelFamily } : null;
  }

  const parsedCapabilities = capabilities(descriptor.capabilities);
  const parsedPriority = priority(descriptor.priority);
  if (!canonical || !parsedCapabilities || parsedPriority === null) return null;
  seenIds.add(id);
  return {
    id,
    roles,
    tool: canonical.tool,
    label: canonical.label,
    invocation,
    modelFamily,
    priority: parsedPriority,
    capabilities: parsedCapabilities
  };
}

function catalogCandidates(repoPath: string): CatalogCandidate[] | null {
  const registry = record(readJsonUnder(repoPath, ".agents-registry.json", MAX_REGISTRY_BYTES));
  if (
    !registry ||
    !onlyKnownKeys(registry, REGISTRY_FIELDS) ||
    (registry._comment !== undefined && typeof registry._comment !== "string") ||
    registry.version !== "dispatch/1" ||
    !Array.isArray(registry.agents) ||
    registry.agents.length < 1 ||
    registry.agents.length > 50
  ) {
    return null;
  }
  const seenIds = new Set<string>();
  const candidates: CatalogCandidate[] = [];
  for (const descriptor of registry.agents) {
    const candidate = candidateFromDescriptor(repoPath, descriptor, seenIds);
    if (!candidate) return null;
    candidates.push(candidate);
  }
  return candidates;
}

function buildCatalog(candidates: readonly CatalogCandidate[]): HarnessToolCatalogEntry[] | null {
  const entries: HarnessToolCatalogEntry[] = [];
  for (const role of HARNESS_MODE_ROLES) {
    const pools = new Map<string, CatalogCandidate[]>();
    for (const candidate of candidates) {
      if (!candidate.roles.includes(role)) continue;
      const key = `${candidate.tool}\u0000${candidate.invocation}`;
      pools.set(key, [...(pools.get(key) ?? []), candidate]);
    }
    for (const pool of pools.values()) {
      const labels = new Set(pool.map((candidate) => candidate.label));
      if (labels.size !== 1) return null;
      entries.push({
        tool: pool[0].tool,
        label: pool[0].label,
        invocation: pool[0].invocation,
        role,
        agentCount: pool.length,
        modelFamilies: [...new Set(pool.map((candidate) => candidate.modelFamily))].sort((left, right) => left.localeCompare(right)),
        capabilities: [...new Set(pool.flatMap((candidate) => candidate.capabilities))].sort((left, right) => left.localeCompare(right))
      });
    }
  }
  return entries.sort((left, right) =>
    `${left.role}\u0000${left.tool}\u0000${left.invocation}`.localeCompare(
      `${right.role}\u0000${right.tool}\u0000${right.invocation}`
    )
  );
}

/**
 * Data-only mirror of the framework's `tool-catalog/1` catalog command.
 * Project-owned scripts are deliberately never executed by the Tokenizer
 * device agent. New compatible descriptors/adapters become visible through
 * this registry-driven parser without an application/UI release.
 */
export function readDispatchToolCatalog(repoPath: string): ToolCatalogReadResult {
  const candidates = catalogCandidates(repoPath);
  const entries = candidates ? buildCatalog(candidates) : null;
  return entries
    ? { entries, issue: null }
    : { entries: [], issue: "dispatch tool catalog is unavailable" };
}
