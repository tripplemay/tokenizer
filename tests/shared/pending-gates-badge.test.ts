import { describe, expect, it } from "vitest";
import {
  PENDING_GATES_POLL_MS,
  shouldRenderPendingBadge
} from "../../app/_components/pending-gates-badge";

describe("pending gates badge", () => {
  it("keeps the poll cadence aligned with the /harness AutoRefresh interval", () => {
    expect(PENDING_GATES_POLL_MS).toBe(30_000);
  });

  it("renders only for a positive count; zero and load-failure stay silent", () => {
    expect(shouldRenderPendingBadge(3)).toBe(true);
    expect(shouldRenderPendingBadge(0)).toBe(false);
    expect(shouldRenderPendingBadge(null)).toBe(false);
  });
});
