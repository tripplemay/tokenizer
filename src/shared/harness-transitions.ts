// BL-TRANSITION-LOG F002：时间线口径纯函数。
// 输入是 HarnessTransition 镜像差分行（60s 轮询观测，见 spec §3 精度口径），输出按批次
// 分组的阶段 segments。本模块必须保持纯函数：不 import prisma / next / react。

export interface TransitionRow {
  fromStatus: string | null;
  toStatus: string;
  fromBatch: string | null;
  toBatch: string | null;
  batchBoundary: boolean;
  fixRounds: number;
  observedAfter: Date | string | null;
  observedAt: Date | string;
}

export interface TimelineSegment {
  phase: string;
  start: Date;
  /** null = 时间线末段仍在进行中 */
  end: Date | null;
  /** null = 无法诚实计时（进行中且上报不新鲜，或初始观测行的未知起点） */
  durationMs: number | null;
  /** 该段起点的观测区间 (observedAfter, observedAt] 超过阈值——真实流转时刻不精确 */
  lowPrecision: boolean;
  /** fromStatus null：镜像首次观测，阶段真实起点未知，耗时按下界呈现 */
  initialObservation: boolean;
  /** 非状态机法定相邻边——轮询间隔内穿越了多个阶段被压缩（中间态永久丢失） */
  nonAdjacent: boolean;
  fixRounds: number;
}

export interface BatchTimeline {
  batch: string | null;
  segments: TimelineSegment[];
  /** 组内可诚实计时段的耗时合计；跨批次边界不聚合 */
  totalMs: number | null;
}

/** 观测区间超过该阈值即标记 lowPrecision（agent 离线/休眠导致的宽区间） */
export const TRANSITION_LOW_PRECISION_MS = 10 * 60 * 1000;

/** 状态机法定相邻边（harness-rules.md 状态流转图，含 done→new 的批次续接） */
const LEGAL_EDGES = new Set([
  "new>planning",
  "planning>building",
  "planning>verifying",
  "building>verifying",
  "verifying>fixing",
  "verifying>done",
  "fixing>reverifying",
  "reverifying>fixing",
  "reverifying>done",
  "done>new",
  "done>planning"
]);

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface TimelineOptions {
  now: Date;
  /** 复用 isFreshHarnessProjectReport 的判定（20 分钟窗口）由调用方传入 */
  reportIsFresh: boolean;
}

export function buildTransitionTimeline(
  rows: readonly TransitionRow[],
  options: TimelineOptions
): BatchTimeline[] {
  const ordered = rows
    .map((row) => ({ row, observedAt: toDate(row.observedAt) }))
    .filter((entry): entry is { row: TransitionRow; observedAt: Date } => entry.observedAt !== null)
    .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  if (ordered.length === 0) return [];

  const groups: BatchTimeline[] = [];
  let current: BatchTimeline | null = null;

  for (let index = 0; index < ordered.length; index += 1) {
    const { row, observedAt } = ordered[index];
    const initialObservation = row.fromStatus === null;
    // 批次边界行开启新组；首行 / 批次键变化同理
    if (current === null || row.batchBoundary || current.batch !== (row.toBatch ?? null)) {
      current = { batch: row.toBatch ?? null, segments: [], totalMs: null };
      groups.push(current);
    }

    const next = index + 1 < ordered.length ? ordered[index + 1] : null;
    // 下一行若属新批次，本段随批次一起终止于下一行观测时刻
    const end = next !== null ? next.observedAt : null;

    let durationMs: number | null;
    if (end !== null) {
      durationMs = end.getTime() - observedAt.getTime();
    } else {
      durationMs = options.reportIsFresh ? options.now.getTime() - observedAt.getTime() : null;
    }
    if (durationMs !== null && durationMs < 0) durationMs = 0;

    const observedAfter = toDate(row.observedAfter);
    const lowPrecision =
      observedAfter !== null && observedAt.getTime() - observedAfter.getTime() > TRANSITION_LOW_PRECISION_MS;
    const nonAdjacent =
      !initialObservation && !row.batchBoundary && !LEGAL_EDGES.has(`${row.fromStatus}>${row.toStatus}`);

    current.segments.push({
      phase: row.toStatus,
      start: observedAt,
      end,
      durationMs,
      lowPrecision,
      initialObservation,
      nonAdjacent,
      fixRounds: row.fixRounds
    });
  }

  for (const group of groups) {
    const measurable = group.segments
      .filter((segment) => segment.durationMs !== null && !segment.initialObservation)
      .map((segment) => segment.durationMs as number);
    group.totalMs = measurable.length > 0 ? measurable.reduce((sum, value) => sum + value, 0) : null;
  }
  return groups;
}
