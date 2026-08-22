import { unstable_cache } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { estimateCost, type ModelPriceRow } from "@/shared/model-pricing";
import { getEffectivePrices } from "./model-prices";
import { MODEL_PRICES_CACHE_TAG } from "@/shared/model-price";

// BL-COST-BATCH-V1 F001：批次/阶段成本归因聚合层。
// 用 HarnessTransition 的阶段流转把批次折成时间区间，再对 UsageEvent 做
// occurredAt 时间窗 join。v1 是时间窗近似：同项目同时段的非批次用量会被
// 计入（多算方向）；未定价模型不入 costUsd（少算方向，以 unpriced 字段显式
// 披露）；>100 条流转的截断为已知边界。v2 精确归因（agent 报 batch id）落地
// 时只换数据源、不换本层接口。刻意独立成文件：summaries.ts 已 1128 行且无
// 集成测试，本层纯函数占比最大化。

const CACHE_REVALIDATE_SECONDS = 30;
export const CLOSED_BATCH_NOW_MS = 0;
export const MAX_LINKED_HARNESS_PROJECTS = 20;
/** 区间上限：fixing⟷reverifying 多轮爆炸时合并最旧，防逐区间查询放大 */
export const MAX_PHASE_INTERVALS = 60;

/** 与 HarnessTransition 行对应的最小输入形状（observedAt 为切点，见 spec 适配表） */
export interface TransitionLike {
  fromStatus: string | null;
  toStatus: string;
  toBatch: string | null;
  batchBoundary: boolean;
  fixRounds: number;
  observedAt: Date;
}

export interface PhaseInterval {
  phase: string;
  batch: string | null;
  fixRounds: number;
  start: Date;
  /** null 仅在构建中间态出现；输出中当前阶段以 now 封闭 */
  end: Date;
  openEnded: boolean;
}

// 返回值的时间字段一律 ISO 串：unstable_cache 命中时值经 JSON 反序列化，
// Date 会静默降级为 string——从类型上钉死，杜绝「首渲染是 Date、命中后是
// string」的隐性双形态。
export interface PhaseCostRow {
  phase: string;
  batch: string | null;
  fixRounds: number;
  startIso: string;
  endIso: string;
  openEnded: boolean;
  durationMs: number;
  computeTokens: number;
  costUsd: number;
  /** 未定价模型的 compute tokens：计入 computeTokens 但不计入 costUsd（少算路径的显式披露，评审 F-31） */
  unpricedComputeTokens: number;
}

export interface BatchCost {
  batch: string | null;
  totalCostUsd: number;
  totalComputeTokens: number;
  phases: PhaseCostRow[];
  /** fixing + reverifying 各轮合计（返工小计） */
  reworkCostUsd: number;
  reworkComputeTokens: number;
  /** 任一阶段含未定价模型用量时为 true——UI 必须随金额披露 */
  hasUnpricedUsage: boolean;
  unpricedComputeTokens: number;
  windowStartIso: string;
  windowEndIso: string;
}

/** 终态：批次到此为止，成本窗口封闭——done 之后的同项目用量不再计入本批 */
const TERMINAL_PHASES = new Set(["done"]);

/**
 * 把 transition 序列折成阶段区间。纯函数、无 DB 依赖。
 * - 每行 observedAt 是上一阶段的结束点、toStatus 阶段的开始点
 * - batchBoundary=true 行切断聚合：只保留**最后一个批次**的区间（HarnessProject
 *   镜像只存当前批次，跨批次窗口归因交给调用方按 toBatch 过滤后的序列）
 * - fromStatus=null 的首次观测行只开启区间，不产生「未知阶段」
 * - 当前**非终态**阶段为开区间，以 now 封闭；**终态（done）零宽封闭**——
 *   fixing 轮修复（评审 F-31）：done 后批次总额不得随 now 继续上涨
 * - 区间数超过 MAX_PHASE_INTERVALS 时合并最旧的相邻区间
 */
export function buildPhaseIntervals(transitions: TransitionLike[], now: Date): PhaseInterval[] {
  const ordered = [...transitions].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  let intervals: PhaseInterval[] = [];
  let open: PhaseInterval | null = null;

  for (const t of ordered) {
    if (t.batchBoundary) {
      // 跨批次：丢弃旧批次已积累的区间，从边界行重新开始
      intervals = [];
      open = null;
    }
    if (open) {
      intervals.push({ ...open, end: t.observedAt, openEnded: false });
    }
    open = {
      phase: t.toStatus,
      batch: t.toBatch,
      fixRounds: t.fixRounds,
      start: t.observedAt,
      end: t.observedAt,
      openEnded: true
    };
  }
  if (open) {
    if (TERMINAL_PHASES.has(open.phase)) {
      intervals.push({ ...open, end: open.start, openEnded: false });
    } else {
      const end = now.getTime() > open.start.getTime() ? now : open.start;
      intervals.push({ ...open, end, openEnded: true });
    }
  }

  // 上限合并：吸收最旧区间到其后继（保留后继的 phase 标签，窗口取并）
  while (intervals.length > MAX_PHASE_INTERVALS) {
    const [oldest, next, ...rest] = intervals;
    intervals = [{ ...next, start: oldest.start }, ...rest];
  }
  return intervals;
}

type PhaseUsageRow = {
  intervalIdx: number;
  model: string | null;
  _sum: {
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
  };
};

type PhaseUsageQueryRow = {
  intervalIdx: number | bigint;
  model: string | null;
  inputTokens: number | bigint;
  cachedInputTokens: number | bigint;
  cacheWriteTokens: number | bigint;
  outputTokens: number | bigint;
};

function phaseCost(
  interval: PhaseInterval,
  rows: PhaseUsageRow[],
  prices: Record<string, ModelPriceRow>
): PhaseCostRow {
  let compute = 0;
  let cost = 0;
  let unpriced = 0;
  for (const row of rows) {
    const i = row._sum.inputTokens ?? 0;
    const c = row._sum.cachedInputTokens ?? 0;
    const o = row._sum.outputTokens ?? 0;
    const w = row._sum.cacheWriteTokens ?? 0;
    // compute 口径 = max(0, input − cached) + output，与 summaries.ts billableOf 逐字一致
    const rowCompute = Math.max(0, i - c) + o;
    compute += rowCompute;
    const dollars = estimateCost(row.model, { inputTokens: i, cachedInputTokens: c, cacheWriteTokens: w, outputTokens: o }, prices);
    if (dollars != null) {
      cost += dollars;
    } else {
      // 未定价模型不静默：tokens 显式归入 unpriced，costUsd 因此可能少算——由 UI 披露
      unpriced += rowCompute;
    }
  }
  return {
    phase: interval.phase,
    batch: interval.batch,
    fixRounds: interval.fixRounds,
    startIso: interval.start.toISOString(),
    endIso: interval.end.toISOString(),
    openEnded: interval.openEnded,
    durationMs: Math.max(0, interval.end.getTime() - interval.start.getTime()),
    computeTokens: compute,
    costUsd: cost,
    unpricedComputeTokens: unpriced
  };
}

async function loadPhaseUsage(
  userId: string,
  link: { projectId: string | null; repoKey: string | null },
  intervals: PhaseInterval[]
): Promise<Map<number, PhaseUsageRow[]>> {
  const linkPredicate = link.projectId
    ? Prisma.sql`usage."projectId" = ${link.projectId}`
    : Prisma.sql`usage."repoKey" = ${link.repoKey}`;
  const intervalValues = Prisma.join(
    intervals.map(
      (interval, index) =>
        Prisma.sql`(${index}::integer, ${interval.start}::timestamptz, ${interval.end}::timestamptz)`
    )
  );

  // One range join replaces N interval-specific groupBy calls. The [start,end)
  // boundary is unchanged: events exactly on a transition belong to the next
  // interval, and events exactly on the final end are excluded.
  const rows = await prisma.$queryRaw<PhaseUsageQueryRow[]>(Prisma.sql`
    WITH intervals("intervalIdx", "startAt", "endAt") AS (
      VALUES ${intervalValues}
    )
    SELECT
      intervals."intervalIdx" AS "intervalIdx",
      usage."model" AS "model",
      SUM(usage."inputTokens")::bigint AS "inputTokens",
      SUM(usage."cachedInputTokens")::bigint AS "cachedInputTokens",
      SUM(usage."cacheWriteTokens")::bigint AS "cacheWriteTokens",
      SUM(usage."outputTokens")::bigint AS "outputTokens"
    FROM intervals
    JOIN "UsageEvent" AS usage
      ON usage."occurredAt" >= intervals."startAt"
     AND usage."occurredAt" < intervals."endAt"
    WHERE usage."userId" = ${userId}
      AND ${linkPredicate}
    GROUP BY intervals."intervalIdx", usage."model"
    ORDER BY intervals."intervalIdx" ASC
  `);

  const byInterval = new Map<number, PhaseUsageRow[]>();
  for (const row of rows) {
    const intervalIdx = Number(row.intervalIdx);
    if (!Number.isInteger(intervalIdx) || intervalIdx < 0 || intervalIdx >= intervals.length) {
      throw new Error("Batch cost query returned an invalid interval index");
    }
    const bucket = byInterval.get(intervalIdx) ?? [];
    bucket.push({
      intervalIdx,
      model: row.model,
      _sum: {
        inputTokens: Number(row.inputTokens),
        cachedInputTokens: Number(row.cachedInputTokens),
        cacheWriteTokens: Number(row.cacheWriteTokens),
        outputTokens: Number(row.outputTokens)
      }
    });
    byInterval.set(intervalIdx, bucket);
  }
  return byInterval;
}

const REWORK_PHASES = new Set(["fixing", "reverifying"]);

async function getBatchCostImpl(
  userId: string,
  link: { projectId: string | null; repoKey: string | null },
  transitions: TransitionLike[],
  nowMs: number
): Promise<BatchCost | null> {
  const intervals = buildPhaseIntervals(transitions, new Date(nowMs));
  if (intervals.length === 0) return null;
  // 关联键回退链：projectId 优先；null 时按 repoKey；两者皆空不发起任何查询
  if (!link.projectId && !link.repoKey) return null;

  const prices = await getEffectivePrices();
  const usageByInterval = await loadPhaseUsage(userId, link, intervals);
  const phases = intervals.map((interval, index) => phaseCost(interval, usageByInterval.get(index) ?? [], prices));
  const rework = phases.filter((p) => REWORK_PHASES.has(p.phase));
  return {
    batch: phases.at(-1)?.batch ?? null,
    totalCostUsd: phases.reduce((sum, p) => sum + p.costUsd, 0),
    totalComputeTokens: phases.reduce((sum, p) => sum + p.computeTokens, 0),
    phases,
    reworkCostUsd: rework.reduce((sum, p) => sum + p.costUsd, 0),
    reworkComputeTokens: rework.reduce((sum, p) => sum + p.computeTokens, 0),
    hasUnpricedUsage: phases.some((p) => p.unpricedComputeTokens > 0),
    unpricedComputeTokens: phases.reduce((sum, p) => sum + p.unpricedComputeTokens, 0),
    windowStartIso: phases[0].startIso,
    windowEndIso: phases.at(-1)!.endIso
  };
}

/**
 * 批次成本聚合（30s 缓存，与 summaries.ts 同款包装）。两页卡片（/harness/[id]
 * overview 与 /projects/[id] 联动）必须共用本导出，不许各写 where（口径漂移防线）。
 * now 由调用方钉毫秒值——unstable_cache 的 key 含参数，注入时间保证同窗口命中。
 */
const getActiveBatchCost = unstable_cache(
  async (
    userId: string,
    link: { projectId: string | null; repoKey: string | null },
    transitions: TransitionLike[],
    nowMs: number
  ) => getBatchCostImpl(userId, link, transitions, nowMs),
  ["getBatchCost"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: [MODEL_PRICES_CACHE_TAG] }
);

const getClosedBatchCost = unstable_cache(
  async (
    userId: string,
    link: { projectId: string | null; repoKey: string | null },
    transitions: TransitionLike[],
    nowMs: number
  ) => getBatchCostImpl(userId, link, transitions, nowMs),
  ["getBatchCost", "closed"],
  { revalidate: false, tags: [MODEL_PRICES_CACHE_TAG] }
);

/** Pure cache-key decision: only a non-empty, fully closed interval set is immutable. */
export function allPhaseIntervalsClosed(transitions: TransitionLike[], nowMs: number): boolean {
  const intervals = buildPhaseIntervals(transitions, new Date(nowMs));
  return intervals.length > 0 && intervals.every((interval) => !interval.openEnded);
}

export function batchCostCacheNowMs(transitions: TransitionLike[], nowMs: number): number {
  return allPhaseIntervalsClosed(transitions, nowMs) ? CLOSED_BATCH_NOW_MS : nowMs;
}

export function getBatchCost(
  userId: string,
  link: { projectId: string | null; repoKey: string | null },
  transitions: TransitionLike[],
  nowMs: number
): Promise<BatchCost | null> {
  const cacheNowMs = batchCostCacheNowMs(transitions, nowMs);
  const cached = cacheNowMs === CLOSED_BATCH_NOW_MS ? getClosedBatchCost : getActiveBatchCost;
  return cached(userId, link, transitions, cacheNowMs);
}

/**
 * 缓存窗口对齐的 now：量化到 30s 粒度，使两页在同一窗口内拿到相同 cache key
 * （F003 acceptance 1「同口径同值」的机械保证——原始 Date.now() 每次渲染都变，
 * 会让 unstable_cache 永不命中且两页各算各的）。
 */
export function quantizedNowMs(): number {
  return Math.floor(Date.now() / (CACHE_REVALIDATE_SECONDS * 1000)) * CACHE_REVALIDATE_SECONDS * 1000;
}

/** 供页面取 transitions 的标准查询（两页共用；切窗由 buildPhaseIntervals 按边界行完成） */
export async function loadCurrentBatchTransitions(harnessProjectId: string): Promise<TransitionLike[]> {
  return prisma.harnessTransition.findMany({
    where: { harnessProjectId },
    orderBy: { observedAt: "asc" },
    select: {
      fromStatus: true,
      toStatus: true,
      toBatch: true,
      batchBoundary: true,
      fixRounds: true,
      observedAt: true
    }
  });
}
