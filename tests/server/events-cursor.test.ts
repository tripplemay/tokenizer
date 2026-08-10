import { describe, expect, it } from "vitest";
import {
  EVENTS_PAGE_SIZE,
  decodeEventsCursor,
  encodeEventsCursor,
  eventsCursorWhere
} from "../../src/server/events-cursor";

const ID = "clx0abcdefghijklmnop12345";
const AT = new Date("2026-08-10T12:34:56.789Z");

describe("events cursor codec", () => {
  it("round-trips encode → decode", () => {
    const decoded = decodeEventsCursor(encodeEventsCursor({ occurredAt: AT, id: ID }));
    expect(decoded).toEqual({ occurredAt: AT, id: ID });
  });

  it("rejects malformed, truncated, or hostile input as null (never throws)", () => {
    for (const junk of [
      undefined,
      null,
      42,
      "",
      "xxx",
      "_",
      `${AT.toISOString()}_`,
      `_${ID}`,
      `not-a-date_${ID}`,
      `${AT.toISOString()}_NOT/AN/ID`,
      `2026-08-10T12:34:56.789Z_${"x".repeat(200)}`,
      // 非规范化时间串（缺毫秒）不得通过往返校验，防止游标歧义
      `2026-08-10T12:34:56Z_${ID}`
    ]) {
      expect(decodeEventsCursor(junk)).toBeNull();
    }
  });

  it("keeps the page size at 200", () => {
    expect(EVENTS_PAGE_SIZE).toBe(200);
  });
});

describe("eventsCursorWhere", () => {
  it("filters strictly-older rows with an id tiebreak inside the same millisecond", () => {
    const where = eventsCursorWhere({ occurredAt: AT, id: ID });
    expect(where).toEqual({
      OR: [
        { occurredAt: { lt: AT } },
        { occurredAt: AT, id: { lt: ID } }
      ]
    });
  });

  it("orders same-timestamp ids so pagination never repeats or skips", () => {
    const rows = [
      { occurredAt: AT, id: "clx0zzzzzzzzzzzzzzzzzzzzz" },
      { occurredAt: AT, id: ID },
      { occurredAt: new Date(AT.getTime() - 1), id: "clx0aaaaaaaaaaaaaaaaaaaaa" }
    ];
    const cursor = { occurredAt: AT, id: ID };
    const { OR } = eventsCursorWhere(cursor);
    const matches = rows.filter(
      (row) =>
        row.occurredAt.getTime() < (OR[0].occurredAt as { lt: Date }).lt.getTime() ||
        (row.occurredAt.getTime() === cursor.occurredAt.getTime() && row.id < cursor.id)
    );
    expect(matches).toEqual([rows[2]]);
  });
});
