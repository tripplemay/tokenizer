import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "@/cli/atomic-file";
import { canonicalJson } from "@/server/harness-sign";
import { normalizeHarnessRepoKey } from "@/shared/harness-mode-intent";
import { normalizeWorkspacePath } from "@/shared/path";
import { normalizeGitRemote } from "./git";
import { readCredentials, readState, updateState, TokenizerConfig } from "./config";
import { agentFetch } from "./fetch";
import { buildModeSnapshot } from "./harness-modes";
import { scanHarnessDispatchRuns } from "./harness-dispatch";
import {
  HARNESS_SYNC_ISSUE_LIMIT,
  parseHarnessSyncSnapshot,
  safeHarnessCode,
  safeHarnessProject,
  type HarnessSyncIssue,
  type HarnessSyncOperation,
  type HarnessSyncSnapshot
} from "@/shared/harness-health";
import {
  parseModeIntentRelayResponse,
  readModeDefaultsReportSummary,
  stageHarnessModeIntent,
  type StagedModeIntentResult
} from "./harness-mode-intents";

/**
 * harness（Triad Workflow）编排状态的上报与闸门决策中继。
 *
 * 两个方向：
 *   ↑ 上报：读本机各 harness 项目的 progress.json / features.json，POST /api/harness/report
 *   ↓ 中继：GET /api/harness/decisions 取**已签名**的批准，验签后写回本机 progress.json
 *
 * 🔴 中继方向的安全前提：决策必须带控制台签发的 Ed25519 签名，且本 agent **在写入前先验签**。
 * 原因：写入是本地行为，如果不验签，任何能调这个 API 的东西（包括机器上写代码的 agent）
 * 都能让一条伪造的批准落盘，「阶段推进键归人」就退化成自觉。仓库里没有 console.pub 就
 * 拒绝写入——宁可卡住，也不落一条无法验证来源的批准。
 */

const REQUEST_TIMEOUT_MS = 30_000;

class HarnessRequestError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean
  ) {
    super(code);
  }
}

function appendIssue(issues: HarnessSyncIssue[], issue: HarnessSyncIssue): void {
  if (issues.length < HARNESS_SYNC_ISSUE_LIMIT) issues.push(issue);
}

function makeIssue(
  operation: HarnessSyncOperation,
  project: string | null,
  code: string,
  retryable: boolean
): HarnessSyncIssue {
  return {
    operation,
    project: safeHarnessProject(project),
    code: safeHarnessCode(code) ?? "local_error",
    retryable
  };
}

function isRetryableHttp(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function requestError(response: Response): Promise<HarnessRequestError> {
  let responseCode: string | null = null;
  try {
    const body = (await response.json()) as { code?: unknown };
    responseCode = safeHarnessCode(body?.code);
  } catch {
    /* Response bodies never enter diagnostics; malformed or absent JSON uses the status fallback. */
  }
  return new HarnessRequestError(responseCode ?? `http_${response.status}`, isRetryableHttp(response.status));
}

function issueFromError(
  operation: HarnessSyncOperation,
  project: string | null,
  error: unknown
): HarnessSyncIssue {
  if (error instanceof HarnessRequestError) return makeIssue(operation, project, error.code, error.retryable);
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") return makeIssue(operation, project, "timeout", true);
  const code = (error as { code?: unknown; cause?: { code?: unknown } })?.code ??
    (error as { cause?: { code?: unknown } })?.cause?.code;
  if (
    error instanceof TypeError ||
    (typeof code === "string" && ["ECONNRESET", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "ETIMEDOUT"].includes(code))
  ) {
    return makeIssue(operation, project, "network_error", true);
  }
  return makeIssue(operation, project, "local_error", false);
}

export type HarnessRepo = {
  path: string;
  name: string;
  repoKey: string;
};

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * 在 projectRoots 下发现 harness 项目。
 *
 * 判据是「同时有 progress.json 与 harness-rules.md」——只有 progress.json 太宽（很多项目
 * 都可能叫这个名字），加上 harness-rules.md 才能确定是 bootstrap 铺出来的 harness 项目。
 * 只扫一层子目录：projectRoots 本身就是「项目的父目录」，再深就会扫进 node_modules。
 */
export function discoverHarnessRepos(config: TokenizerConfig): HarnessRepo[] {
  const found: HarnessRepo[] = [];
  const seen = new Set<string>();

  const consider = (dir: string) => {
    if (!existsSync(join(dir, "progress.json")) || !existsSync(join(dir, "harness-rules.md"))) return;
    const root = git(["rev-parse", "--show-toplevel"], dir);
    if (!root || seen.has(root)) return;
    const repoKey = normalizeGitRemote(git(["remote", "get-url", "origin"], dir));
    // Local-only projects need a stable per-device identity without sending their root path.
    const normalizedRoot = normalizeWorkspacePath(root);
    const key = repoKey ?? `local:sha256:${createHash("sha256").update(normalizedRoot).digest("hex")}`;
    seen.add(root);
    found.push({ path: root, name: normalizedRoot.split(/[\\/]/).filter(Boolean).pop() ?? root, repoKey: key });
  };

  for (const rootPath of config.projectRoots ?? []) {
    if (!existsSync(rootPath)) continue;
    consider(rootPath);
    let entries: string[] = [];
    try {
      entries = readdirSync(rootPath);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const child = join(rootPath, entry);
      try {
        if (statSync(child).isDirectory()) consider(child);
      } catch {
        /* 权限或断链，跳过 */
      }
    }
  }
  return found;
}

type ProgressJson = {
  status?: string | null;
  current_sprint?: string | null;
  fix_rounds?: number;
  docs?: { signoff?: string | null };
  dashboard_url?: string | null;
  autonomy?: { status?: string | null; last_halt?: { condition?: string | null; detail?: string | null } | null };
  pending_gate?: Record<string, unknown> | null;
  mode_intent?: { intent_id?: string; applied_batch?: string; applied_at?: string } | null;
  features?: Array<Record<string, unknown>>;
};

type FeaturesJson = {
  sprint?: string;
  features?: Array<{ id?: string; title?: string; status?: string; executor?: string }>;
};

/** 组装一个 harness 项目的上报载荷。读不到 progress.json 就返回 null（该项目本轮跳过）。 */
export function buildReport(repo: HarnessRepo) {
  const progress = readJson<ProgressJson>(join(repo.path, "progress.json"));
  if (!progress) return null;
  const featuresFile = readJson<FeaturesJson>(join(repo.path, "features.json"));
  const features = featuresFile?.features ?? progress.features ?? [];
  const completed = features.filter((f) => (f as { status?: string }).status === "completed").length;
  const batches = new Set(
    [progress.current_sprint, featuresFile?.sprint].filter((value): value is string => typeof value === "string" && value.length > 0)
  );
  const knownFeatures = new Set(
    features.map((feature) => (feature as { id?: unknown }).id).filter((id): id is string => typeof id === "string")
  );
  const modeDefaults = readModeDefaultsReportSummary(repo.path);
  const modeIntent = progress.mode_intent;
  const appliedModeIntent =
    modeIntent &&
    typeof modeIntent.intent_id === "string" &&
    typeof modeIntent.applied_batch === "string" &&
    typeof modeIntent.applied_at === "string"
      ? {
          intentId: modeIntent.intent_id,
          appliedAt: modeIntent.applied_at,
          appliedBatch: modeIntent.applied_batch
        }
      : null;

  const gate = progress.pending_gate ?? null;
  const reportGate =
    gate && !gate.decision
      ? {
          id: gate.id,
          kind: gate.kind,
          batch: gate.batch,
          from_status: gate.from_status,
          to_status: gate.to_status,
          detail: gate.detail,
          evidence: gate.evidence,
          raised_at: gate.raised_at,
          raised_by: gate.raised_by
        }
      : null;
  return {
    repoKey: repo.repoKey,
    name: repo.name,
    state: {
      status: progress.status ?? null,
      batch: progress.current_sprint ?? null,
      fixRounds: progress.fix_rounds ?? 0,
      completed,
      total: features.length,
      headSha: git(["rev-parse", "HEAD"], repo.path),
      signoff: progress.docs?.signoff ?? null,
      dashboardUrl: progress.dashboard_url ?? null,
      autonomyStatus: progress.autonomy?.status ?? null,
      lastHalt: progress.autonomy?.last_halt ?? null,
      features: features.map((f) => ({
        id: (f as { id?: string }).id,
        title: (f as { title?: string }).title,
        status: (f as { status?: string }).status,
        executor: (f as { executor?: string }).executor
      })),
      // 模式指纹：六个维度的开关散在五个文件里，人要回答「这项目现在什么模式」得逐个翻。
      // 只读镜像——算错只让控制台显示错，机器上的校验器一道不少。
      modes: buildModeSnapshot(repo.path),
      modeDefaults,
      modeIntent: appliedModeIntent
    },
    // 只上报还没有决策的闸门；已决策的以服务端记录为准，避免本机旧副本覆盖
    gate: reportGate,
    dispatchRuns: scanHarnessDispatchRuns(repo.path, batches, knownFeatures)
  };
}

type ModeIntentAck =
  | {
      projectId: string;
      intentId: string;
      status: "staged";
      stagedAt: string;
      stagedCommitSha: string;
    }
  | {
      projectId: string;
      intentId: string;
      status: "applied";
      appliedAt: string;
      appliedBatch: string;
    }
  | {
      projectId: string;
      intentId: string;
      status: "failed";
      failedAt: string;
      failureCode: string;
    };

async function postModeIntentAck(config: TokenizerConfig, deviceToken: string, ack: ModeIntentAck): Promise<void> {
  const response = await agentFetch(`${config.serverUrl.replace(/\/+$/, "")}/api/harness/mode-intents/relay`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${deviceToken}` },
    body: JSON.stringify(ack),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw await requestError(response);
}

/**
 * 上报本机所有 harness 项目的状态。
 *
 * 一个项目上报失败**不中断其余项目**：上报是只读镜像，服务端渲染不出某个项目
 * 不影响任何状态机；而中途抛出会连累后面的项目和紧随其后的闸门中继——
 * 那是人在网页上按了批准、机器却一直拿不到的那条路。故逐条收集原因、继续往下走。
 */
export async function reportHarnessState(
  config: TokenizerConfig
): Promise<{
  reported: number;
  failedReports: number;
  skippedReports: string[];
  skippedAppliedAcks: string[];
  issues: HarnessSyncIssue[];
}> {
  const repos = discoverHarnessRepos(config);
  const credentials = readCredentials();
  const skippedReports: string[] = [];
  const skippedAppliedAcks: string[] = [];
  const issues: HarnessSyncIssue[] = [];
  let reported = 0;
  let failedReports = 0;

  for (const repo of repos) {
    try {
      const body = buildReport(repo);
      if (!body) {
        failedReports += 1;
        skippedReports.push(`${repo.name}: progress.json 读不出来，本轮跳过`);
        appendIssue(issues, makeIssue("report", repo.name, "local_error", false));
        continue;
      }
      const response = await agentFetch(`${config.serverUrl.replace(/\/+$/, "")}/api/harness/report`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${credentials.deviceToken}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      if (!response.ok) {
        const error = await requestError(response);
        failedReports += 1;
        skippedReports.push(`${repo.name}: 上报失败 ${response.status}`);
        appendIssue(issues, issueFromError("report", repo.name, error));
        continue;
      }
      const responseBody = (await response.json().catch(() => null)) as { harnessProjectId?: unknown } | null;
      const modeIntent = body.state.modeIntent;
      if (
        modeIntent &&
        typeof responseBody?.harnessProjectId === "string" &&
        responseBody.harnessProjectId.length > 0 &&
        responseBody.harnessProjectId.length <= 128
      ) {
        await postModeIntentAck(config, credentials.deviceToken, {
          projectId: responseBody.harnessProjectId,
          intentId: modeIntent.intentId,
          status: "applied",
          appliedAt: modeIntent.appliedAt,
          appliedBatch: modeIntent.appliedBatch
        }).catch((error) => {
          skippedAppliedAcks.push(
            `${repo.name}: applied ACK 失败 ${error instanceof Error ? error.message : String(error)}`
          );
          appendIssue(issues, issueFromError("applied_ack", repo.name, error));
        });
      }
    } catch (error) {
      failedReports += 1;
      skippedReports.push(`${repo.name}: 上报失败 ${error instanceof Error ? error.message : String(error)}`);
      appendIssue(issues, issueFromError("report", repo.name, error));
      continue;
    }
    reported += 1;
  }
  return { reported, failedReports, skippedReports, skippedAppliedAcks, issues };
}

function ackForStageResult(result: Exclude<StagedModeIntentResult, { status: "ack_pending" }>): ModeIntentAck {
  return result.status === "staged"
    ? {
        projectId: result.projectId,
        intentId: result.intentId,
        status: "staged",
        stagedAt: result.stagedAt,
        stagedCommitSha: result.stagedCommitSha
      }
    : {
        projectId: result.projectId,
        intentId: result.intentId,
        status: "failed",
        failedAt: result.failedAt,
        failureCode: result.failureCode
      };
}

/** Pull, validate, stage, and ACK signed defaults without touching progress or gate state. */
export async function applyHarnessModeIntents(
  config: TokenizerConfig
): Promise<{ stagedIntents: number; skippedModeIntents: string[]; issues: HarnessSyncIssue[] }> {
  const credentials = readCredentials();
  const response = await agentFetch(`${config.serverUrl.replace(/\/+$/, "")}/api/harness/mode-intents/relay`, {
    headers: { authorization: `Bearer ${credentials.deviceToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw await requestError(response);
  const intents = parseModeIntentRelayResponse(await response.text());
  if (intents.length === 0) return { stagedIntents: 0, skippedModeIntents: [], issues: [] };

  const repos = discoverHarnessRepos(config);
  const byRepoKey = new Map<string, HarnessRepo>();
  for (const repo of repos) {
    try {
      byRepoKey.set(normalizeHarnessRepoKey(repo.repoKey), repo);
    } catch {
      /* A local-only repo cannot be a valid signed relay target. */
    }
  }

  let stagedIntents = 0;
  const skippedModeIntents: string[] = [];
  const issues: HarnessSyncIssue[] = [];
  for (const item of intents) {
    let repo: HarnessRepo | undefined;
    try {
      repo = byRepoKey.get(normalizeHarnessRepoKey(item.repoKey));
    } catch {
      repo = undefined;
    }
    const now = new Date();
    const result = repo
      ? stageHarnessModeIntent(repo, item, now)
      : {
          status: "failed" as const,
          projectId: item.projectId,
          intentId: item.intent.intent_id,
          failedAt: now.toISOString(),
          failureCode: "repo_not_found"
        };
    if (result.status === "staged") stagedIntents += 1;
    else if (result.status === "ack_pending") {
      stagedIntents += 1;
      skippedModeIntents.push(`${result.intentId}: staged ACK deferred until exact retry`);
      appendIssue(issues, makeIssue("mode_intent", repo?.name ?? null, "ack_pending", true));
      continue;
    } else {
      skippedModeIntents.push(`${result.intentId}: ${result.failureCode}`);
      appendIssue(
        issues,
        makeIssue("mode_intent", repo?.name ?? null, safeHarnessCode(result.failureCode) ?? "local_error", false)
      );
    }

    await postModeIntentAck(config, credentials.deviceToken, ackForStageResult(result)).catch((error) => {
      skippedModeIntents.push(
        `${result.intentId}: ACK 失败 ${error instanceof Error ? error.message : String(error)}`
      );
      appendIssue(issues, issueFromError("mode_intent", repo?.name ?? null, error));
    });
  }
  return { stagedIntents, skippedModeIntents, issues };
}

type RelayedDecision = {
  repoKey: string;
  gate_id: string;
  decision: Record<string, unknown> & { gate_id?: string; sig?: string };
};

/**
 * 用仓库里的 console.pub 验签。
 *
 * 载荷 = decision 除 sig 外的全部字段，用与服务端**同一个** canonicalJson——
 * 两份实现漂移就会表现为「批准了却不生效」，故此处直接复用而非另写一份。
 */
function verifyDecision(repoPath: string, decision: Record<string, unknown>): boolean {
  const pubPath = join(repoPath, ".claude", "console", "console.pub");
  if (!existsSync(pubPath)) return false;
  const { sig, ...payload } = decision as { sig?: string };
  if (typeof sig !== "string" || !sig) return false;
  try {
    return edVerify(
      null,
      Buffer.from(canonicalJson(payload), "utf8"),
      createPublicKey(readFileSync(pubPath, "utf8")),
      Buffer.from(sig, "base64")
    );
  } catch {
    return false;
  }
}

/**
 * 把已签名的闸门决策写回本机仓库。
 *
 * 逐条守门，任一不满足即跳过（下次 tick 再试，服务端幂等）：
 *   · 仓库里有 console.pub 且签名有效
 *   · 本机 pending_gate 存在且 id 与决策一致（防陈旧批准解锁另一个闸门）
 *   · 本机 pending_gate 尚无 decision（不覆盖）
 *   · progress.json 无未提交改动（避免与状态机正在写的内容打架）
 */
export async function applyHarnessDecisions(
  config: TokenizerConfig
): Promise<{ applied: number; skipped: string[]; issues: HarnessSyncIssue[] }> {
  const credentials = readCredentials();
  const response = await agentFetch(`${config.serverUrl.replace(/\/+$/, "")}/api/harness/decisions`, {
    headers: { authorization: `Bearer ${credentials.deviceToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) {
    throw await requestError(response);
  }
  const { decisions } = (await response.json()) as { decisions: RelayedDecision[] };
  if (!decisions?.length) return { applied: 0, skipped: [], issues: [] };

  const byKey = new Map(discoverHarnessRepos(config).map((r) => [r.repoKey, r]));
  const skipped: string[] = [];
  const issues: HarnessSyncIssue[] = [];
  let applied = 0;

  for (const item of decisions) {
    const repo = byKey.get(item.repoKey);
    if (!repo) {
      skipped.push(`${item.gate_id}: 本机没有 repoKey=${item.repoKey} 的 harness 项目`);
      appendIssue(issues, makeIssue("relay", null, "repo_not_found", false));
      continue;
    }
    if (!verifyDecision(repo.path, item.decision)) {
      // 不写。仓库缺 console.pub，或签名对不上——两种情况都不该让它落盘。
      skipped.push(`${item.gate_id}: 验签失败或仓库缺 .claude/console/console.pub`);
      appendIssue(issues, makeIssue("relay", repo.name, "signature_invalid", false));
      continue;
    }
    const progressPath = join(repo.path, "progress.json");
    const dirty = git(["status", "--porcelain", "--", "progress.json"], repo.path);
    if (dirty) {
      skipped.push(`${item.gate_id}: progress.json 有未提交改动，本轮不写（下次再试）`);
      appendIssue(issues, makeIssue("relay", repo.name, "local_write_rejected", false));
      continue;
    }
    const progress = readJson<ProgressJson>(progressPath);
    const gate = progress?.pending_gate as { id?: string; decision?: unknown } | null | undefined;
    if (!gate?.id) {
      skipped.push(`${item.gate_id}: 本机已无待批闸门`);
      appendIssue(issues, makeIssue("relay", repo.name, "gate_not_pending", false));
      continue;
    }
    if (gate.id !== item.gate_id) {
      skipped.push(`${item.gate_id}: 本机当前闸门是 ${gate.id}，不匹配`);
      appendIssue(issues, makeIssue("relay", repo.name, "gate_mismatch", false));
      continue;
    }
    if (gate.decision) {
      skipped.push(`${item.gate_id}: 本机闸门已有决策，不覆盖`);
      appendIssue(issues, makeIssue("relay", repo.name, "already_decided", false));
      continue;
    }

    try {
      gate.decision = item.decision;
      writeFileAtomic(progressPath, `${JSON.stringify(progress, null, 2)}\n`);
      // 只提交 progress.json 这一个文件——绝不 `git add -A`，那会把用户正在写的东西一起卷进来
      git(["add", "--", "progress.json"], repo.path);
      git(["commit", "-m", `chore(gate): relay ${item.gate_id} from console`, "--", "progress.json"], repo.path);
      applied += 1;
    } catch {
      skipped.push(`${item.gate_id}: 本机写入失败`);
      appendIssue(issues, makeIssue("relay", repo.name, "local_write_rejected", false));
    }
  }
  return { applied, skipped, issues };
}

/**
 * 一次完整的 harness 同步：先上报状态，再中继决策。
 *
 * **两步互不阻塞**：任一步失败都只记进它自己的 skip 列表，另一步照跑。
 * 上报只是镜像，中继才是人在等的那条路——不能让镜像的问题卡住批准。
 */
export type HarnessSyncResult = {
  reported: number;
  failed: number;
  skippedReports: string[];
  skippedAppliedAcks: string[];
  applied: number;
  skipped: string[];
  stagedIntents: number;
  skippedModeIntents: string[];
  issues: HarnessSyncIssue[];
  snapshot: HarnessSyncSnapshot;
  issueDetailsChanged: boolean;
  recovered: boolean;
};

function issueFingerprint(issues: HarnessSyncIssue[]): string {
  return JSON.stringify(
    issues
      .map((issue) => `${issue.operation}\u0000${issue.project ?? ""}\u0000${issue.code}\u0000${issue.retryable}`)
      .sort()
  );
}

export function readHarnessSyncSnapshot(): HarnessSyncSnapshot | null {
  return parseHarnessSyncSnapshot(readState().harness);
}

export async function runHarnessSync(config: TokenizerConfig): Promise<HarnessSyncResult> {
  const attemptedAt = new Date().toISOString();
  const previous = readHarnessSyncSnapshot();
  const discoveredCount = discoverHarnessRepos(config).length;
  const fail = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const report = await reportHarnessState(config).catch((error) => ({
    reported: 0,
    failedReports: discoveredCount,
    skippedReports: [`report: ${fail(error)}`],
    skippedAppliedAcks: [],
    issues: [issueFromError("report", null, error)]
  }));
  const modeIntents = await applyHarnessModeIntents(config).catch((error) => ({
    stagedIntents: 0,
    skippedModeIntents: [`mode-intent: ${fail(error)}`],
    issues: [issueFromError("mode_intent", null, error)]
  }));
  const relay = await applyHarnessDecisions(config).catch((error) => ({
    applied: 0,
    skipped: [`relay: ${fail(error)}`],
    issues: [issueFromError("relay", null, error)]
  }));
  const issues = [...report.issues, ...modeIntents.issues, ...relay.issues].slice(0, HARNESS_SYNC_ISSUE_LIMIT);
  const successfulOperations = report.reported + modeIntents.stagedIntents + relay.applied;
  const status = issues.length > 0
    ? successfulOperations > 0 ? "degraded" : "failed"
    : successfulOperations > 0 ? "success" : "idle";
  const snapshot: HarnessSyncSnapshot = {
    attemptedAt,
    status,
    reported: report.reported,
    failed: report.failedReports,
    relayed: relay.applied,
    modeIntents: modeIntents.stagedIntents,
    issues
  };
  const issueDetailsChanged = issues.length > 0 && issueFingerprint(issues) !== issueFingerprint(previous?.issues ?? []);
  const recovered = issues.length === 0 && (previous?.issues.length ?? 0) > 0;
  updateState({ harness: snapshot });
  return {
    reported: report.reported,
    failed: report.failedReports,
    skippedReports: report.skippedReports,
    skippedAppliedAcks: report.skippedAppliedAcks,
    applied: relay.applied,
    skipped: relay.skipped,
    stagedIntents: modeIntents.stagedIntents,
    skippedModeIntents: modeIntents.skippedModeIntents,
    issues,
    snapshot,
    issueDetailsChanged,
    recovered
  };
}
