// BL-GATE-INBOX F002 隔离验收探针（evaluator 独立构造，超出 generator 自带 7 用例的场景）。
// 验收对象：notifyPendingGate 的 fail-open 铁则——任何失败路径永不 throw，
// 发送失败必须复位 claim 且复位范围不得触碰已决策/已消费的闸门。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: { harnessGate: { findFirst: vi.fn(), updateMany: vi.fn() } }
}));
vi.mock("@/server/db", () => ({ prisma: mocks.prisma }));

import { notifyPendingGate } from "../../src/server/harness-gate-notify";

const SCOPE = {
  userId: "user-1",
  harnessProjectId: "hp-1",
  gateId: "BL-PROBE-verifying-done-w1",
  requestOrigin: "https://token.example.test"
};

function gateRow() {
  return {
    id: "gate-db-1",
    kind: "phase_advance",
    batch: "BL-PROBE",
    fromStatus: "verifying",
    toStatus: "done",
    detail: "probe",
    raisedAt: new Date("2026-08-10T02:00:00.000Z"),
    harnessProject: { name: "tokenizer", repoKey: "github.com/acme/tokenizer" },
    user: { email: "owner@example.test" }
  };
}

describe("notifyPendingGate fail-open probes (evaluator)", () => {
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

  it("probe 1: Resend 返回 HTTP 500（ok:false 而非网络异常）→ 不 throw 且复位 claim，范围不触碰已决策闸门", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(notifyPendingGate(SCOPE)).resolves.toBeUndefined();
    // 第一次 updateMany 是 claim，最后一次必须是复位
    const calls = mocks.prisma.harnessGate.updateMany.mock.calls;
    expect(calls.length).toBe(2);
    const reset = calls.at(-1)?.[0];
    expect(reset.data).toEqual({ notifiedAt: null });
    // 复位 where 必须限定 未消费 + 未决策，防止把已批准闸门的通知标记翻回去
    expect(reset.where).toMatchObject({
      userId: SCOPE.userId,
      harnessProjectId: SCOPE.harnessProjectId,
      gateId: SCOPE.gateId,
      consumedAt: null,
      decisionAction: null
    });
  });

  it("probe 2: findFirst 抛错（数据库不可用）→ 不 throw、不发信", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    mocks.prisma.harnessGate.findFirst.mockRejectedValue(new Error("db down"));
    await expect(notifyPendingGate(SCOPE)).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("probe 3: 发送失败且复位自身也失败（fail-open 到底）→ 仍不 throw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    mocks.prisma.harnessGate.updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim 成功
      .mockRejectedValueOnce(new Error("db down during reset")); // 复位失败
    await expect(notifyPendingGate(SCOPE)).resolves.toBeUndefined();
  });

  it("probe 4: claim updateMany 抛错 → 不 throw、不发信", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    mocks.prisma.harnessGate.updateMany
      .mockRejectedValueOnce(new Error("db down during claim")) // claim 抛错
      .mockResolvedValue({ count: 1 }); // catch 内复位可成功
    await expect(notifyPendingGate(SCOPE)).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
