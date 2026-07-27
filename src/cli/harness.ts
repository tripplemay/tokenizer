import { execFileSync } from "node:child_process";
import { createPublicKey, verify as edVerify } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "@/cli/atomic-file";
import { canonicalJson } from "@/server/harness-sign";
import { normalizeHarnessRepoKey } from "@/shared/harness-mode-intent";
import { normalizeGitRemote } from "./git";
import { readCredentials, TokenizerConfig } from "./config";
import { agentFetch } from "./fetch";
import { buildModeSnapshot } from "./harness-modes";
import { scanHarnessDispatchRuns } from "./harness-dispatch";
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
    // 没有 remote 就没有稳定的跨机器身份，回落到本机路径并标注，避免与他人的同名项目串号
    const key = repoKey ?? `local:${root}`;
    seen.add(root);
    found.push({ path: root, name: root.split("/").filter(Boolean).pop() ?? root, repoKey: key });
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
    gate: gate && !gate.decision ? gate : null,
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
  if (!response.ok) throw new Error(`mode intent ACK failed: ${response.status}`);
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
): Promise<{ reported: number; skippedReports: string[]; skippedAppliedAcks: string[] }> {
  const repos = discoverHarnessRepos(config);
  const credentials = readCredentials();
  const skippedReports: string[] = [];
  const skippedAppliedAcks: string[] = [];
  let reported = 0;

  for (const repo of repos) {
    const body = buildReport(repo);
    if (!body) {
      skippedReports.push(`${repo.name}: progress.json 读不出来，本轮跳过`);
      continue;
    }
    try {
      const response = await agentFetch(`${config.serverUrl.replace(/\/+$/, "")}/api/harness/report`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${credentials.deviceToken}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      if (!response.ok) {
        skippedReports.push(`${repo.name}: 上报失败 ${response.status}`);
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
        });
      }
    } catch (error) {
      skippedReports.push(`${repo.name}: 上报失败 ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    reported += 1;
  }
  return { reported, skippedReports, skippedAppliedAcks };
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
): Promise<{ stagedIntents: number; skippedModeIntents: string[] }> {
  const credentials = readCredentials();
  const response = await agentFetch(`${config.serverUrl.replace(/\/+$/, "")}/api/harness/mode-intents/relay`, {
    headers: { authorization: `Bearer ${credentials.deviceToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`harness mode intents failed: ${response.status}`);
  const intents = parseModeIntentRelayResponse(await response.text());
  if (intents.length === 0) return { stagedIntents: 0, skippedModeIntents: [] };

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
      continue;
    } else skippedModeIntents.push(`${result.intentId}: ${result.failureCode}`);

    await postModeIntentAck(config, credentials.deviceToken, ackForStageResult(result)).catch((error) => {
      skippedModeIntents.push(
        `${result.intentId}: ACK 失败 ${error instanceof Error ? error.message : String(error)}`
      );
    });
  }
  return { stagedIntents, skippedModeIntents };
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
): Promise<{ applied: number; skipped: string[] }> {
  const credentials = readCredentials();
  const response = await agentFetch(`${config.serverUrl.replace(/\/+$/, "")}/api/harness/decisions`, {
    headers: { authorization: `Bearer ${credentials.deviceToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new Error(`harness decisions failed: ${response.status} ${await response.text()}`);
  }
  const { decisions } = (await response.json()) as { decisions: RelayedDecision[] };
  if (!decisions?.length) return { applied: 0, skipped: [] };

  const byKey = new Map(discoverHarnessRepos(config).map((r) => [r.repoKey, r]));
  const skipped: string[] = [];
  let applied = 0;

  for (const item of decisions) {
    const repo = byKey.get(item.repoKey);
    if (!repo) {
      skipped.push(`${item.gate_id}: 本机没有 repoKey=${item.repoKey} 的 harness 项目`);
      continue;
    }
    if (!verifyDecision(repo.path, item.decision)) {
      // 不写。仓库缺 console.pub，或签名对不上——两种情况都不该让它落盘。
      skipped.push(`${item.gate_id}: 验签失败或仓库缺 .claude/console/console.pub`);
      continue;
    }
    const progressPath = join(repo.path, "progress.json");
    const dirty = git(["status", "--porcelain", "--", "progress.json"], repo.path);
    if (dirty) {
      skipped.push(`${item.gate_id}: progress.json 有未提交改动，本轮不写（下次再试）`);
      continue;
    }
    const progress = readJson<ProgressJson>(progressPath);
    const gate = progress?.pending_gate as { id?: string; decision?: unknown } | null | undefined;
    if (!gate?.id) {
      skipped.push(`${item.gate_id}: 本机已无待批闸门`);
      continue;
    }
    if (gate.id !== item.gate_id) {
      skipped.push(`${item.gate_id}: 本机当前闸门是 ${gate.id}，不匹配`);
      continue;
    }
    if (gate.decision) {
      skipped.push(`${item.gate_id}: 本机闸门已有决策，不覆盖`);
      continue;
    }

    gate.decision = item.decision;
    writeFileAtomic(progressPath, `${JSON.stringify(progress, null, 2)}\n`);
    // 只提交 progress.json 这一个文件——绝不 `git add -A`，那会把用户正在写的东西一起卷进来
    git(["add", "--", "progress.json"], repo.path);
    git(["commit", "-m", `chore(gate): relay ${item.gate_id} from console`, "--", "progress.json"], repo.path);
    applied += 1;
  }
  return { applied, skipped };
}

/**
 * 一次完整的 harness 同步：先上报状态，再中继决策。
 *
 * **两步互不阻塞**：任一步失败都只记进它自己的 skip 列表，另一步照跑。
 * 上报只是镜像，中继才是人在等的那条路——不能让镜像的问题卡住批准。
 */
export async function runHarnessSync(config: TokenizerConfig): Promise<{
  reported: number;
  skippedReports: string[];
  skippedAppliedAcks: string[];
  applied: number;
  skipped: string[];
  stagedIntents: number;
  skippedModeIntents: string[];
}> {
  const fail = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const report = await reportHarnessState(config).catch((error) => ({
    reported: 0,
    skippedReports: [`report: ${fail(error)}`],
    skippedAppliedAcks: []
  }));
  const modeIntents = await applyHarnessModeIntents(config).catch((error) => ({
    stagedIntents: 0,
    skippedModeIntents: [`mode-intent: ${fail(error)}`]
  }));
  const relay = await applyHarnessDecisions(config).catch((error) => ({
    applied: 0,
    skipped: [`relay: ${fail(error)}`]
  }));
  return { ...report, ...relay, ...modeIntents };
}
