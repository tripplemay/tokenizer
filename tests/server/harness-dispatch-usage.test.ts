import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    device: { findUnique: vi.fn(), updateMany: vi.fn() },
    deviceToken: { updateMany: vi.fn() },
    harnessProject: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    harnessGate: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    harnessModeIntent: { updateMany: vi.fn() },
    harnessDispatchRun: { upsert: vi.fn() },
    harnessTransition: { create: vi.fn() },
    harnessBatchArchive: { upsert: vi.fn() },
    usageEvent: { upsert: vi.fn() }
  };
  return {
    authenticateDeviceToken: vi.fn(),
    tx,
    prisma: {
      project: { findFirst: vi.fn() },
      $transaction: vi.fn(),
      harnessProject: { findFirst: vi.fn(), findMany: vi.fn() }
    }
  };
});

vi.mock("@/server/auth", () => ({
  authenticateDeviceToken: mocks.authenticateDeviceToken,
  unauthorized: () => Response.json({ error: "unauthorized" }, { status: 401 }),
  forbidden: (message: string) => Response.json({ error: message }, { status: 403 })
}));
vi.mock("@/server/db", () => ({ prisma: mocks.prisma }));

import { POST } from "../../app/api/harness/report/route";
import { parseDispatchRuns } from "../../src/server/harness-mode-intent-api";

const HEAD = "0123456789abcdef0123456789abcdef01234567";

function usage(overrides: Record<string, unknown> = {}) {
  return {
    model: null,
    input_tokens: 2_150_425,
    cached_input_tokens: 2_008_832,
    cache_write_tokens: 0,
    output_tokens: 19_667,
    reasoning_tokens: 7_702,
    turns: 1,
    extracted_from: "run-log",
    ...overrides
  };
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    taskId: "build-abc123-20260810T000000Z",
    batch: "BL-TEST",
    feature: "F001",
    role: "generator",
    agentId: "local-cli--codex--generator",
    modelFamily: "codex",
    transport: "local-cli",
    lockedSha: HEAD,
    startedAt: "2026-08-10T00:00:00.000Z",
    finishedAt: "2026-08-10T00:10:00.000Z",
    durationMs: 600_000,
    outcome: "RETURNED",
    exitCode: 0,
    verdict: "COMPLETED",
    artifactPath: "generator-handoff.json",
    artifactSha256: "a".repeat(64),
    errorSummary: null,
    ...overrides
  };
}

function report(dispatchRuns: unknown[]) {
  return {
    repoKey: "github.com/acme/tokenizer",
    name: "tokenizer",
    agent: { releaseVersion: "1.2.1", featureVersion: 9 },
    state: {
      status: "building",
      batch: "BL-TEST",
      fixRounds: 0,
      completed: 0,
      total: 4,
      headSha: HEAD,
      features: [],
      modes: null
    },
    gate: null,
    dispatchRuns
  };
}

function request(body: unknown) {
  return new Request("http://localhost/api/harness/report", {
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify(body)
  }) as never;
}

describe("dispatch usage parsing", () => {
  it("flattens a valid materialize usage block into columns", () => {
    const [parsed] = parseDispatchRuns([run({ usage: usage(), usageCapture: "materialize" })]);
    expect(parsed).toMatchObject({
      usageModel: null,
      usageInputTokens: 2_150_425,
      usageCachedInputTokens: 2_008_832,
      usageCacheWriteTokens: 0,
      usageOutputTokens: 19_667,
      usageReasoningTokens: 7_702,
      usageTurns: 1,
      usageCapture: "materialize"
    });
  });

  it("keeps all usage columns null when the block is absent", () => {
    const [parsed] = parseDispatchRuns([run()]);
    expect(parsed.usageInputTokens).toBeNull();
    expect(parsed.usageCapture).toBeNull();
  });

  it.each([
    ["unknown usage field", { usage: usage({ price_usd: 1 }), usageCapture: "materialize" }],
    ["negative tokens", { usage: usage({ input_tokens: -1 }), usageCapture: "materialize" }],
    ["foreign extraction source", { usage: usage({ extracted_from: "guess" }), usageCapture: "materialize" }],
    ["invalid capture mode", { usage: usage(), usageCapture: "billing" }]
  ])("rejects %s", (_label, overrides) => {
    expect(() => parseDispatchRuns([run(overrides)])).toThrowError();
  });
});

describe("dispatch usage materialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateDeviceToken.mockResolvedValue({ id: "token-1", userId: "user-1", deviceId: "device-1" });
    mocks.prisma.project.findFirst.mockResolvedValue({ id: "usage-project-1" });
    mocks.prisma.harnessProject.findMany.mockResolvedValue([]);
    mocks.tx.deviceToken.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.device.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.device.findUnique.mockResolvedValue({ agentReleaseVersion: null, agentFeatureVersion: null });
    mocks.tx.harnessProject.findMany.mockResolvedValue([]);
    mocks.tx.harnessProject.findUnique.mockResolvedValue(null);
    mocks.tx.harnessProject.upsert.mockResolvedValue({ id: "harness-project-1", userId: "user-1", batch: "BL-TEST" });
    mocks.tx.harnessGate.findMany.mockResolvedValue([]);
    mocks.tx.harnessGate.findUnique.mockResolvedValue(null);
    mocks.tx.harnessGate.updateMany.mockResolvedValue({ count: 0 });
    mocks.tx.harnessGate.upsert.mockResolvedValue({});
    mocks.tx.harnessModeIntent.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.harnessDispatchRun.upsert.mockResolvedValue({ id: "dispatch-1" });
    mocks.tx.harnessTransition.create.mockResolvedValue({});
    mocks.tx.harnessBatchArchive.upsert.mockResolvedValue({});
    mocks.tx.usageEvent.upsert.mockResolvedValue({});
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx));
  });

  it("materializes a codex run into an idempotent usage event with attribution metadata", async () => {
    const response = await POST(request(report([run({ usage: usage(), usageCapture: "materialize" })])));
    expect(response.status).toBe(200);
    expect(mocks.tx.usageEvent.upsert).toHaveBeenCalledTimes(1);
    const call = mocks.tx.usageEvent.upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      deviceId_source_sourceEventId: {
        deviceId: "device-1",
        source: "codex",
        sourceEventId: "dispatch:build-abc123-20260810T000000Z"
      }
    });
    expect(call.update).toEqual({});
    expect(call.create).toMatchObject({
      userId: "user-1",
      source: "codex",
      projectId: "usage-project-1",
      inputTokens: 2_150_425,
      outputTokens: 19_667,
      totalTokens: 2_150_425 + 19_667,
      rawJson: {
        dispatch: {
          batch: "BL-TEST",
          feature: "F001",
          role: "generator",
          taskId: "build-abc123-20260810T000000Z",
          agentId: "local-cli--codex--generator",
          turns: 1,
          extractedFrom: "run-log"
        }
      }
    });
    expect(call.create.occurredAt).toBeInstanceOf(Date);
  });

  it("never materializes attribution_only usage (kimi double-count defense)", async () => {
    const response = await POST(
      request(
        report([
          run({
            runId: "run-2",
            taskId: "verify-1",
            role: "evaluator",
            agentId: "local-cli--kimi--evaluator",
            modelFamily: "kimi",
            usage: usage(),
            usageCapture: "attribution_only"
          })
        ])
      )
    );
    expect(response.status).toBe(200);
    expect(mocks.tx.usageEvent.upsert).not.toHaveBeenCalled();
    // 归因列仍然入库
    const runData = mocks.tx.harnessDispatchRun.upsert.mock.calls[0][0].create;
    expect(runData.usageInputTokens).toBe(2_150_425);
    expect(runData.usageCapture).toBe("attribution_only");
  });

  it("skips materialization for families without a usage source mapping", async () => {
    const response = await POST(
      request(report([run({ modelFamily: "claude", agentId: "x--claude--g", usage: usage(), usageCapture: "materialize" })]))
    );
    expect(response.status).toBe(200);
    expect(mocks.tx.usageEvent.upsert).not.toHaveBeenCalled();
  });

  it("leaves legacy payloads without usage untouched", async () => {
    const response = await POST(request(report([run()])));
    expect(response.status).toBe(200);
    expect(mocks.tx.usageEvent.upsert).not.toHaveBeenCalled();
    const runData = mocks.tx.harnessDispatchRun.upsert.mock.calls[0][0].create;
    expect(runData.usageInputTokens).toBeNull();
  });
});
