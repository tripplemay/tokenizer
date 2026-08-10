// BL-AGENT-LATENCY F004：/events cursor 分页的编解码与查询构造纯函数。
// 游标 = `${occurredAt UTC ISO}_${id}`：occurredAt 走既有 @@index([userId,
// occurredAt])，id 只在同毫秒簇内 tiebreak。非法/篡改 cursor 解码为 null，
// 页面静默回退第一页——分页参数永远不该变成 500。

export const EVENTS_PAGE_SIZE = 200;

export interface EventsCursor {
  occurredAt: Date;
  id: string;
}

const CUID_PATTERN = /^[a-z0-9]{20,32}$/;

export function encodeEventsCursor(cursor: EventsCursor): string {
  return `${cursor.occurredAt.toISOString()}_${cursor.id}`;
}

export function decodeEventsCursor(raw: unknown): EventsCursor | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 96) return null;
  const separator = raw.lastIndexOf("_");
  if (separator <= 0 || separator === raw.length - 1) return null;
  const timestamp = raw.slice(0, separator);
  const id = raw.slice(separator + 1);
  if (!CUID_PATTERN.test(id)) return null;
  const occurredAt = new Date(timestamp);
  if (Number.isNaN(occurredAt.getTime()) || occurredAt.toISOString() !== timestamp) return null;
  return { occurredAt, id };
}

/** 严格早于游标：occurredAt < c，同毫秒时 id < cid（与 orderBy desc,desc 对应） */
export function eventsCursorWhere(cursor: EventsCursor): {
  OR: Array<Record<string, unknown>>;
} {
  return {
    OR: [
      { occurredAt: { lt: cursor.occurredAt } },
      { occurredAt: cursor.occurredAt, id: { lt: cursor.id } }
    ]
  };
}
