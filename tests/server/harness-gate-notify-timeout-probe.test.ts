// BL-AGENT-LATENCY F006 隔离验收探针（evaluator 独立构造）。
// 验收对象：notify fetch 的 AbortSignal.timeout(8s) 兜底——
// ① 平台行为：AbortSignal.timeout 到期后 reason 是 name="TimeoutError" 的异常；
// ② 产品行为：fetch 以该异常 reject 时，落入既有 catch → 复位 claim（fail-open 不变，永不 throw）。
// 两段合起来构成「真实超时 → 复位重试」的实证链，无需真等 8 秒。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: { harnessGate: { findFirst: vi.fn(), updateMany: vi.fn() } }
}));
vi.mock("@/server/db", () => ({ prisma: mocks.prisma }));

import { notifyPendingGate } from "../../src/server/harness-gate-notify";

const SCOPE = {
  userId: "user-1",
  harnessProjectId: "hp-1",
  gateId: "BL-TIMEOUT-PROBE-w1",
  requestOrigin: "https://token.example.test"
};

function gateRow() {
  return {
    id: "gate-db-1",
    kind: "phase_advance",
    batch: "BL-TIMEOUT-PROBE",
    fromStatus: "verifying",
    toStatus: "done",
    detail: "probe",
    raisedAt: new Date("2026-08-10T03:00:00.000Z"),
    harnessProject: { name: "tokenizer", repoKey: "github.com/acme/tokenizer" },
    user: { email: "owner@example.test" }
  };
}

describe("notify fetch timeout probes (evaluator, F006)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_RESEND_KEY", "re_probe_key");
    mocks.prisma.harnessGate.findFirst.mockResolvedValue(gateRow());
    mocks.prisma.harnessGate.updateMany.mockResolvedValue({ count: 1 });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("probe T0: 平台行为——AbortSignal.timeout 到期 reason.name === 'TimeoutError'", async () => {
    const signal = AbortSignal.timeout(5);
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    expect(signal.aborted).toBe(true);
    expect((signal.reason as { name?: string }).name).toBe("TimeoutError");
  });

  it("probe T1: fetch 以 TimeoutError reject → 不 throw，复位 claim 且范围不触碰已决策闸门", async () => {
    const timeoutError = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeoutError));
    await expect(notifyPendingGate(SCOPE)).resolves.toBeUndefined();
    const calls = mocks.prisma.harnessGate.updateMany.mock.calls;
    expect(calls.length).toBe(2); // claim + 复位
    const reset = calls.at(-1)?.[0];
    expect(reset.data).toEqual({ notifiedAt: null });
    expect(reset.where).toMatchObject({
      userId: SCOPE.userId,
      harnessProjectId: SCOPE.harnessProjectId,
      gateId: SCOPE.gateId,
      consumedAt: null,
      decisionAction: null
    });
  });

  it("probe T2: 传给 fetch 的 signal 是尚未 abort 的 AbortSignal（发起时刻未被提前掐断）", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    await notifyPendingGate(SCOPE);
    const init = fetchSpy.mock.calls[0]?.[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal.aborted).toBe(false);
  });
});
