import { unstable_cache } from "next/cache";
import { prisma } from "./db";
import { estimateCost, type ModelPriceRow } from "@/shared/model-pricing";
import { getEffectivePrices } from "./model-prices";
import { MODEL_PRICES_CACHE_TAG } from "@/shared/model-price";

// BL-COST-BATCH-V1 F001：批次/阶段成本归因聚合层。
// 用 HarnessTransition 的阶段流转把批次折成时间区间，再对 UsageEvent 做
// occurredAt 时间窗 join。v1 是时间窗近似：同项目同时段的非批次用量会被
// 计入（误差方向恒为「只多不少」），v2 精确归因（agent 报 batch id）落地时
// 只换数据源、不换本层接口。刻意独立成文件：summaries.ts 已 1128 行且无
// 集成测试，本层纯函数占比最大化。

const CACHE_REVALIDATE_SECONDS = 30;
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

export interface PhaseCostRow extends PhaseInterval {
  computeTokens: number;
  costUsd: number;
}

export interface BatchCost {
  batch: string | null;
  totalCostUsd: number;
  totalComputeTokens: number;
  phases: PhaseCostRow[];
  /** fixing + reverifying 各轮合计（返工小计） */
  reworkCostUsd: number;
  reworkComputeTokens: number;
  windowStart: Date;
  windowEnd: Date;
}

/**
 * 把 transition 序列折成阶段区间。纯函数、无 DB 依赖。
 * - 每行 observedAt 是上一阶段的结束点、toStatus 阶段的开始点
 * - batchBoundary=true 行切断聚合：只保留**最后一个批次**的区间（HarnessProject
 *   镜像只存当前批次，跨批次窗口归因交给调用方按 toBatch 过滤后的序列）
 * - fromStatus=null 的首次观测行只开启区间，不产生「未知阶段」
 * - 当前阶段为开区间，以 now 封闭
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
    const end = now.getTime() > open.start.getTime() ? now : open.start;
    intervals.push({ ...open, end, openEnded: true });
  }

  // 上限合并：吸收最旧区间到其后继（保留后继的 phase 标签，窗口取并）
  while (intervals.length > MAX_PHASE_INTERVALS) {
    const [oldest, next, ...rest] = intervals;
    intervals = [{ ...next, start: oldest.start }, ...rest];
  }
  return intervals;
}

async function phaseCost(
  userId: string,
  usageWhere: Record<string, unknown>,
  interval: PhaseInterval,
  prices: Record<string, ModelPriceRow>
): Promise<PhaseCostRow> {
  const rows = await prisma.usageEvent.groupBy({
    by: ["model"],
    where: {
      userId,
      ...usageWhere,
      // 开闭沿：[start, end) —— 与 summaries.ts 的 range 口径一致；恰在边界秒
      // 的事件归属后一阶段（F004 审计以此为准）
      occurredAt: { gte: interval.start, lt: interval.end }
    },
    _sum: { inputTokens: true, cachedInputTokens: true, cacheWriteTokens: true, outputTokens: true }
  });
  let compute = 0;
  let cost = 0;
  for (const row of rows) {
    const i = row._sum.inputTokens ?? 0;
    const c = row._sum.cachedInputTokens ?? 0;
    const o = row._sum.outputTokens ?? 0;
    const w = row._sum.cacheWriteTokens ?? 0;
    // compute 口径 = max(0, input − cached) + output，与 summaries.ts billableOf 逐字一致
    compute += Math.max(0, i - c) + o;
    const dollars = estimateCost(row.model, { inputTokens: i, cachedInputTokens: c, cacheWriteTokens: w, outputTokens: o }, prices);
    if (dollars != null) cost += dollars;
  }
  return { ...interval, computeTokens: compute, costUsd: cost };
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
  const usageWhere = link.projectId
    ? { projectId: link.projectId }
    : link.repoKey
      ? { repoKey: link.repoKey }
      : null;
  if (usageWhere === null) return null;

  const prices = await getEffectivePrices();
  const phases = await Promise.all(intervals.map((interval) => phaseCost(userId, usageWhere, interval, prices)));
  const rework = phases.filter((p) => REWORK_PHASES.has(p.phase));
  return {
    batch: phases.at(-1)?.batch ?? null,
    totalCostUsd: phases.reduce((sum, p) => sum + p.costUsd, 0),
    totalComputeTokens: phases.reduce((sum, p) => sum + p.computeTokens, 0),
    phases,
    reworkCostUsd: rework.reduce((sum, p) => sum + p.costUsd, 0),
    reworkComputeTokens: rework.reduce((sum, p) => sum + p.computeTokens, 0),
    windowStart: phases[0].start,
    windowEnd: phases.at(-1)!.end
  };
}

/**
 * 批次成本聚合（30s 缓存，与 summaries.ts 同款包装）。两页卡片（/harness/[id]
 * overview 与 /projects/[id] 联动）必须共用本导出，不许各写 where（口径漂移防线）。
 * now 由调用方钉毫秒值——unstable_cache 的 key 含参数，注入时间保证同窗口命中。
 */
export const getBatchCost = unstable_cache(
  async (
    userId: string,
    link: { projectId: string | null; repoKey: string | null },
    transitions: TransitionLike[],
    nowMs: number
  ) => getBatchCostImpl(userId, link, transitions, nowMs),
  ["getBatchCost"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: [MODEL_PRICES_CACHE_TAG] }
);

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
