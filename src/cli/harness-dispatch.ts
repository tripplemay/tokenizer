import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  type Stats
} from "node:fs";
import { basename, isAbsolute, join, posix, relative, resolve, win32 } from "node:path";

const MAX_RUN_META_FILES = 50;
const MAX_RUN_META_BYTES = 64 * 1024;
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_DURATION_SECONDS = 7 * 24 * 60 * 60;
const FULL_SHA_PATTERN = /^[0-9a-fA-F]{40}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_PATH_PATTERN = /^[A-Za-z0-9._/-]{1,512}$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const KNOWN_OUTCOMES = new Set(["RETURNED", "FAILED", "TIMEOUT", "CANCELED", "ARTIFACT_MISSING"]);
const KNOWN_ROLES = new Set(["planner", "generator", "evaluator"]);
const KNOWN_TRANSPORTS = new Set(["subagent", "local-cli", "a2a"]);

type UnknownRecord = Record<string, unknown>;

type RegistryAgent = {
  id: string;
  roles: string[];
  modelFamily: string;
  transport: string;
};

export type DispatchRunSummary = {
  runId: string;
  taskId: string;
  batch: string;
  feature: string | null;
  role: string;
  agentId: string;
  modelFamily: string;
  transport: string;
  lockedSha: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outcome: string;
  exitCode: number | null;
  verdict: string | null;
  artifactPath: string | null;
  artifactSha256: string | null;
  errorSummary: string | null;
  /** BL-DISPATCH-USAGE-CAPTURE：extract-run-usage.py 写入 run-meta 的用量摘要（原样透传，服务端二次校验） */
  usage: DispatchUsageSummary | null;
  usageCapture: string | null;
};

type DispatchUsageSummary = {
  model: string | null;
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  turns: number;
  extracted_from: "run-log";
};

const USAGE_CAPTURE_MODES = new Set(["materialize", "attribution_only"]);
const MAX_USAGE_TOKENS = 2_000_000_000;

function boundedUsageInt(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : null;
}

/** run-meta 是本机机件产物但仍按敌意输入解析：任一字段越界即整块弃用（usage 是旁路不是闸门）。 */
function safeUsage(value: unknown): DispatchUsageSummary | null {
  const raw = record(value);
  if (!raw) return null;
  const allowed = new Set([
    "model",
    "input_tokens",
    "cached_input_tokens",
    "cache_write_tokens",
    "output_tokens",
    "reasoning_tokens",
    "turns",
    "extracted_from"
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) return null;
  if (raw.extracted_from !== "run-log") return null;
  const model =
    raw.model === undefined || raw.model === null
      ? null
      : typeof raw.model === "string" && raw.model.length > 0 && raw.model.length <= 128
        ? raw.model
        : null;
  if (model === null && raw.model !== undefined && raw.model !== null) return null;
  const input = boundedUsageInt(raw.input_tokens, 0, MAX_USAGE_TOKENS);
  const cached = boundedUsageInt(raw.cached_input_tokens, 0, MAX_USAGE_TOKENS);
  const cacheWrite = boundedUsageInt(raw.cache_write_tokens, 0, MAX_USAGE_TOKENS);
  const output = boundedUsageInt(raw.output_tokens, 0, MAX_USAGE_TOKENS);
  const reasoning = boundedUsageInt(raw.reasoning_tokens, 0, MAX_USAGE_TOKENS);
  const turns = boundedUsageInt(raw.turns, 1, 10_000);
  if (input === null || cached === null || cacheWrite === null || output === null || reasoning === null || turns === null) {
    return null;
  }
  return {
    model,
    input_tokens: input,
    cached_input_tokens: cached,
    cache_write_tokens: cacheWrite,
    output_tokens: output,
    reasoning_tokens: reasoning,
    turns,
    extracted_from: "run-log"
  };
}

function safeUsageCapture(value: unknown): string | null {
  return typeof value === "string" && USAGE_CAPTURE_MODES.has(value) ? value : null;
}

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function safeId(value: unknown): string | null {
  return typeof value === "string" && SAFE_ID_PATTERN.test(value) ? value : null;
}

function readRegistry(repoPath: string): Map<string, RegistryAgent> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(readFileSync(join(repoPath, ".agents-registry.json"), "utf8"));
  } catch {
    return new Map();
  }
  const registry = record(decoded);
  if (!registry || !Array.isArray(registry.agents) || registry.agents.length > 50) return new Map();
  const agents = new Map<string, RegistryAgent>();
  for (const rawAgent of registry.agents) {
    const agent = record(rawAgent);
    const id = safeId(agent?.id);
    const modelFamily = safeId(agent?.model_family);
    const transport = typeof agent?.transport === "string" ? agent.transport : "";
    const roles = Array.isArray(agent?.roles)
      ? agent.roles.filter((role): role is string => typeof role === "string" && KNOWN_ROLES.has(role))
      : [];
    if (!id || !modelFamily || !KNOWN_TRANSPORTS.has(transport) || agents.has(id)) continue;
    agents.set(id, { id, modelFamily, transport, roles: [...new Set(roles)] });
  }
  return agents;
}

function commitExists(repoPath: string, sha: string): boolean {
  if (!FULL_SHA_PATTERN.test(sha)) return false;
  try {
    return execFileSync("git", ["cat-file", "-t", sha], {
      cwd: repoPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim() === "commit";
  } catch {
    return false;
  }
}

function boundedDuration(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_DURATION_SECONDS
    ? value
    : null;
}

function boundedExitCode(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 255 ? value : null;
}

function utcTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40 || !UTC_TIMESTAMP_PATTERN.test(value)) return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? new Date(epoch).toISOString() : null;
}

type StableFile = { bytes: Buffer; mtimeMs: number };

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

/** Open first, then validate and read the same descriptor so path replacement cannot change the bytes. */
function readStableRegularFile(path: string, maxBytes: number): StableFile | null {
  const noFollow = (constants as typeof constants & { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, constants.O_RDONLY | noFollow);
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size < 1 || before.size > maxBytes) return null;

    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const currentPath = lstatSync(path);
    if (
      !after.isFile() ||
      currentPath.isSymbolicLink() ||
      !currentPath.isFile() ||
      !sameFile(before, after) ||
      !sameFile(after, currentPath) ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      bytes.byteLength !== after.size
    ) {
      return null;
    }
    return { bytes, mtimeMs: after.mtimeMs };
  } catch {
    return null;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function safeRepositoryFile(repoPath: string, normalized: string): string | null {
  try {
    const root = realpathSync(repoPath);
    const filePath = resolve(root, normalized);
    const rel = relative(root, filePath);
    if (rel.startsWith("..") || isAbsolute(rel)) return null;

    let current = root;
    const segments = normalized.split("/");
    for (let index = 0; index < segments.length; index += 1) {
      current = join(current, segments[index]);
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) return null;
      if (index < segments.length - 1 && !stat.isDirectory()) return null;
    }
    return realpathSync(filePath) === filePath ? filePath : null;
  } catch {
    return null;
  }
}

function safeArtifact(
  repoPath: string,
  value: unknown
): { reportPath: string | null; bytes: Buffer | null; sha256: string | null } {
  if (typeof value !== "string" || value.length < 1 || value.length > 2_048) {
    return { reportPath: null, bytes: null, sha256: null };
  }
  const absolute = isAbsolute(value) || win32.isAbsolute(value) || value.startsWith("\\\\");
  if (absolute) {
    const leaf = win32.basename(value) === value ? basename(value) : win32.basename(value);
    return SAFE_ID_PATTERN.test(leaf)
      ? { reportPath: leaf, bytes: null, sha256: null }
      : { reportPath: null, bytes: null, sha256: null };
  }
  if (!SAFE_PATH_PATTERN.test(value) || value.startsWith("~")) {
    return { reportPath: null, bytes: null, sha256: null };
  }
  const normalized = posix.normalize(value);
  const segments = normalized.split("/");
  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    segments.some((segment) => !segment || segment === ".." || segment.toLowerCase().includes("worktree"))
  ) {
    return { reportPath: null, bytes: null, sha256: null };
  }
  const filePath = safeRepositoryFile(repoPath, normalized);
  if (!filePath) return { reportPath: normalized, bytes: null, sha256: null };
  const file = readStableRegularFile(filePath, MAX_ARTIFACT_BYTES);
  if (!file || safeRepositoryFile(repoPath, normalized) !== filePath) {
    return { reportPath: normalized, bytes: null, sha256: null };
  }
  return {
    reportPath: normalized,
    bytes: file.bytes,
    sha256: createHash("sha256").update(file.bytes).digest("hex")
  };
}

function artifactFacts(
  bytes: Buffer | null,
  knownFeatures: ReadonlySet<string>
): { verdict: string | null; feature: string | null } {
  if (!bytes) return { verdict: null, feature: null };
  let artifact: UnknownRecord | null;
  try {
    artifact = record(JSON.parse(bytes.toString("utf8")));
  } catch {
    return { verdict: null, feature: null };
  }
  if (!artifact) return { verdict: null, feature: null };

  const waiting = artifact.waiting;
  if (waiting === "auth" || waiting === "adjudication") {
    return { verdict: waiting === "auth" ? "WAITING_AUTH" : "WAITING_ADJUDICATION", feature: null };
  }

  if (Array.isArray(artifact.verdicts)) {
    const results = artifact.verdicts.map(record).filter((item): item is UnknownRecord => item !== null);
    const featureIds = [
      ...new Set(
        results
          .map((item) => safeId(item.feature_id))
          .filter((id): id is string => id !== null && knownFeatures.has(id))
      )
    ];
    const verdictResults = results.map((item) => item.result).filter((result): result is string => typeof result === "string");
    const verdict = verdictResults.includes("FAIL")
      ? "FAIL"
      : verdictResults.includes("PARTIAL")
        ? "PARTIAL"
        : verdictResults.length > 0 && verdictResults.every((result) => result === "PASS")
          ? "PASS"
          : null;
    return { verdict, feature: featureIds.length === 1 ? featureIds[0] : null };
  }

  if (Array.isArray(artifact.features)) {
    const featureIds = [
      ...new Set(
        artifact.features
          .map(record)
          .filter((item): item is UnknownRecord => item !== null)
          .map((item) => safeId(item.feature_id))
          .filter((id): id is string => id !== null && knownFeatures.has(id))
      )
    ];
    return { verdict: "COMPLETED", feature: featureIds.length === 1 ? featureIds[0] : null };
  }
  return { verdict: null, feature: null };
}

function stableError(outcome: string, artifactPath: string | null): string | null {
  if (outcome === "FAILED") return "process_failed";
  if (outcome === "TIMEOUT") return "timeout";
  if (outcome === "CANCELED") return "canceled";
  if (outcome === "ARTIFACT_MISSING") return "artifact_missing";
  if (outcome === "UNKNOWN") return "unknown_outcome";
  if (outcome === "RETURNED" && artifactPath === null) return "artifact_unavailable";
  return null;
}

function summarizeRun(
  repoPath: string,
  raw: unknown,
  fileMtimeMs: number,
  batches: ReadonlySet<string>,
  knownFeatures: ReadonlySet<string>,
  registry: ReadonlyMap<string, RegistryAgent>
): DispatchRunSummary | null {
  const run = record(raw);
  if (!run) return null;
  const taskId = safeId(run.task_id);
  const runId = safeId(run.run_id) ?? taskId;
  const batch = safeId(run.batch);
  const agentId = safeId(run.agent_id);
  const lockedSha = typeof run.ref === "string" && FULL_SHA_PATTERN.test(run.ref) ? run.ref.toLowerCase() : null;
  if (!taskId || !runId || !batch || !batches.has(batch) || !agentId || !lockedSha || !commitExists(repoPath, lockedSha)) {
    return null;
  }
  const agent = registry.get(agentId);
  if (!agent) return null;
  const rawRole = typeof run.role === "string" && KNOWN_ROLES.has(run.role) ? run.role : null;
  const role = rawRole && agent.roles.includes(rawRole)
    ? rawRole
    : agent.roles.length === 1
      ? agent.roles[0]
      : null;
  if (!role) return null;

  const durationSeconds = boundedDuration(run.duration_s);
  if (durationSeconds === null) return null;
  const fallbackFinishedAt = new Date(fileMtimeMs).toISOString();
  const finishedAt = utcTimestamp(run.finished_at) ?? fallbackFinishedAt;
  const startedAt =
    utcTimestamp(run.started_at) ?? new Date(new Date(finishedAt).getTime() - durationSeconds * 1_000).toISOString();
  if (Date.parse(startedAt) > Date.parse(finishedAt)) return null;

  const rawOutcome = typeof run.outcome === "string" ? run.outcome.toUpperCase() : "UNKNOWN";
  const outcome = KNOWN_OUTCOMES.has(rawOutcome) ? rawOutcome : "UNKNOWN";
  const artifact = safeArtifact(repoPath, run.artifact);
  const facts = artifactFacts(artifact.bytes, knownFeatures);
  const rawFeature = safeId(run.feature);
  const feature = rawFeature && knownFeatures.has(rawFeature) ? rawFeature : facts.feature;

  return {
    runId,
    taskId,
    batch,
    feature,
    role,
    agentId: agent.id,
    modelFamily: agent.modelFamily,
    transport: agent.transport,
    lockedSha,
    startedAt,
    finishedAt,
    durationMs: durationSeconds * 1_000,
    outcome,
    exitCode: boundedExitCode(run.exit_code),
    verdict: outcome === "RETURNED" ? facts.verdict ?? "COMPLETED" : null,
    artifactPath: artifact.reportPath,
    artifactSha256: artifact.sha256,
    errorSummary: stableError(outcome, artifact.reportPath),
    usage: safeUsage(run.usage),
    usageCapture: safeUsageCapture(run.usage_capture)
  };
}

/** Scan only project-root durable run-meta files and return at most the newest 50 safe summaries. */
export function scanHarnessDispatchRuns(
  repoPath: string,
  batches: ReadonlySet<string>,
  knownFeatures: ReadonlySet<string>
): DispatchRunSummary[] {
  const stateDir = join(repoPath, ".harness-dispatch");
  let names: string[];
  try {
    const root = realpathSync(repoPath);
    const stateStat = lstatSync(stateDir);
    if (stateStat.isSymbolicLink() || !stateStat.isDirectory() || realpathSync(stateDir) !== resolve(root, ".harness-dispatch")) {
      return [];
    }
    names = readdirSync(stateDir);
  } catch {
    return [];
  }
  const candidates: Array<{ path: string; mtimeMs: number; bytes: Buffer }> = [];
  for (const name of names) {
    if (!/^run-meta-[A-Za-z0-9._:-]+\.json$/.test(name)) continue;
    const path = join(stateDir, name);
    const file = readStableRegularFile(path, MAX_RUN_META_BYTES);
    if (!file) continue;
    candidates.push({ path, mtimeMs: file.mtimeMs, bytes: file.bytes });
    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
    if (candidates.length > MAX_RUN_META_FILES) candidates.pop();
  }

  const registry = readRegistry(repoPath);
  const summaries: DispatchRunSummary[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(candidate.bytes.toString("utf8"));
    } catch {
      continue;
    }
    const summary = summarizeRun(repoPath, decoded, candidate.mtimeMs, batches, knownFeatures, registry);
    if (!summary || seen.has(summary.runId)) continue;
    seen.add(summary.runId);
    summaries.push(summary);
  }
  return summaries;
}
