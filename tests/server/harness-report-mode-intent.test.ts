import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    device: { findUnique: vi.fn(), updateMany: vi.fn() },
    deviceToken: { updateMany: vi.fn() },
    harnessProject: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    harnessGate: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    harnessModeIntent: { updateMany: vi.fn() },
    harnessDispatchRun: { upsert: vi.fn() }
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

import { GET, POST } from "../../app/api/harness/report/route";

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const F001_TITLE = "Harness 通用契约：签名 mode defaults、/plan 消费与 dispatch 摘要落点";

function modes() {
  return {
    framework: {
      version: "1.4.7",
      commit: HEAD,
      adopted: true,
      managedCount: 120,
      drift: { ok: 120, modified: 0, missing: 0, customized: 0 },
      scanned: true
    },
    execution: "heterogeneous",
    autonomy: { enabled: false, policyValid: null, authorizedBy: null, expiresAt: null, status: null },
    dispatch: {
      enabled: true,
      assignments: { generator: "builder-codex", evaluator: "reviewer-kimi" },
      agents: [],
      familyExclusive: true,
      issues: []
    },
    gate: { pubInstalled: true, guardMode: "signature", pendingGateId: null },
    machinery: { denyListMerged: true, hooks: ["dispatch"], missing: [] },
    pendingDefaults: null
  };
}

type LegacyEmptyToolCatalogModes = Omit<ReturnType<typeof modes>, "dispatch" | "execution"> & {
  execution: "fast";
  current: null;
  dispatch: {
    enabled: boolean;
    assignments: Record<string, string | null>;
    agents: unknown[];
    toolCatalog: unknown;
    familyExclusive: boolean | null;
    issues: string[];
  };
};

/** Exact snapshot emitted by the pre-tool-integrations Agent for a new registry. */
function legacyEmptyToolCatalogModes(): LegacyEmptyToolCatalogModes {
  const { dispatch: _dispatch, ...snapshot } = modes();
  return {
    ...snapshot,
    execution: "fast",
    current: null,
    dispatch: {
      enabled: false,
      assignments: {},
      agents: [],
      toolCatalog: [],
      familyExclusive: null,
      issues: []
    }
  };
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    taskId: "task-1",
    batch: "BL-TEST",
    feature: "F003",
    role: "generator",
    agentId: "builder-codex",
    modelFamily: "codex",
    transport: "local-cli",
    lockedSha: HEAD,
    startedAt: "2026-07-27T12:00:00.000Z",
    finishedAt: "2026-07-27T12:00:01.000Z",
    durationMs: 1_000,
    outcome: "RETURNED",
    exitCode: 0,
    verdict: "COMPLETED",
    artifactPath: "generator-handoff-f003.json",
    artifactSha256: "a".repeat(64),
    errorSummary: null,
    ...overrides
  };
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    repoKey: "github.com/acme/tokenizer",
    name: "tokenizer",
    agent: { releaseVersion: "1.2.1", featureVersion: 9 },
    state: {
      status: "building",
      batch: "BL-TEST",
      fixRounds: 0,
      completed: 2,
      total: 6,
      headSha: HEAD,
      features: [{ id: "F001", title: F001_TITLE, status: "completed", executor: "generator" }],
      modes: modes(),
      modeDefaults: {
        intentId: "intent-1",
        stagedAt: "2026-07-27T12:00:02.000Z",
        stagedCommitSha: HEAD
      },
      modeIntent: {
        intentId: "intent-1",
        appliedAt: "2026-07-27T12:00:03.000Z",
        appliedBatch: "BL-NEXT"
      }
    },
    gate: null,
    dispatchRuns: [run()],
    ...overrides
  };
}

function request(body: unknown) {
  return new Request("http://localhost/api/harness/report", {
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify(body)
  }) as never;
}

describe("harness report mode activation and dispatch summaries", () => {
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
    mocks.tx.harnessProject.update.mockResolvedValue({ id: "legacy-project" });
    mocks.tx.harnessProject.upsert.mockResolvedValue({
      id: "harness-project-1",
      userId: "user-1",
      batch: "BL-TEST"
    });
    mocks.tx.harnessGate.findMany.mockResolvedValue([]);
    mocks.tx.harnessGate.findUnique.mockResolvedValue(null);
    mocks.tx.harnessGate.updateMany.mockResolvedValue({ count: 0 });
    mocks.tx.harnessGate.upsert.mockResolvedValue({});
    mocks.tx.harnessModeIntent.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.harnessDispatchRun.upsert.mockResolvedValue({ id: "dispatch-1" });
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx));
  });

  it("validates every dispatch summary before the first query or write", async () => {
    for (const invalidRun of [
      run({ prompt: "raw prompt" }),
      run({ artifactPath: "/Users/alice/private/result.json" }),
      run({ errorSummary: "stdout=full raw output" })
    ]) {
      vi.clearAllMocks();
      mocks.authenticateDeviceToken.mockResolvedValue({ id: "token-1", userId: "user-1", deviceId: "device-1" });
      const response = await POST(request(report({ dispatchRuns: [invalidRun] })));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(JSON.stringify(body)).not.toContain("raw prompt");
      expect(JSON.stringify(body)).not.toContain("/Users/alice");
      expect(mocks.prisma.project.findFirst).not.toHaveBeenCalled();
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["missing identity", undefined],
    ["null identity", null],
    ["older release", { releaseVersion: "1.2.0", featureVersion: 9 }],
    ["older capability", { releaseVersion: "1.2.1", featureVersion: 8 }]
  ])("rejects a %s before it can overwrite accepted Harness state", async (_label, agent) => {
    mocks.tx.device.findUnique.mockResolvedValueOnce({ agentReleaseVersion: "1.2.1", agentFeatureVersion: 9 });

    const response = await POST(request(report({ agent })));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "stale_agent_report" });
    expect(mocks.tx.harnessProject.findMany).not.toHaveBeenCalled();
    expect(mocks.tx.harnessProject.findUnique).not.toHaveBeenCalled();
    expect(mocks.tx.harnessProject.update).not.toHaveBeenCalled();
    expect(mocks.tx.harnessProject.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.harnessGate.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.harnessGate.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.harnessModeIntent.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.harnessDispatchRun.upsert).not.toHaveBeenCalled();
  });

  it("rechecks a token revoked after request authentication before any Harness write", async () => {
    mocks.tx.deviceToken.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await POST(request(report()));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "device_token_revoked" });
    expect(mocks.tx.device.updateMany).toHaveBeenCalledOnce();
    expect(mocks.tx.device.findUnique).not.toHaveBeenCalled();
    expect(mocks.tx.harnessProject.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.harnessGate.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.harnessModeIntent.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.harnessDispatchRun.upsert).not.toHaveBeenCalled();
  });

  it("accepts a matching capability 9 reporter", async () => {
    mocks.tx.device.findUnique.mockResolvedValueOnce({ agentReleaseVersion: "1.2.1", agentFeatureVersion: 9 });

    const response = await POST(request(report()));

    expect(response.status).toBe(200);
    expect(mocks.tx.harnessProject.upsert).toHaveBeenCalledOnce();
    expect(mocks.tx.device.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.tx.device.findUnique.mock.invocationCallOrder[0]);
    expect(mocks.tx.device.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.tx.deviceToken.updateMany.mock.invocationCallOrder[0]);
  });

  it("promotes an accepted versioned report before it writes Harness state", async () => {
    mocks.tx.device.findUnique.mockResolvedValueOnce({ agentReleaseVersion: "1.2.0", agentFeatureVersion: 8 });

    const response = await POST(request(report()));

    expect(response.status).toBe(200);
    expect(mocks.tx.device.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "device-1", userId: "user-1" },
      data: { agentReleaseVersion: "1.2.1", agentFeatureVersion: 9 }
    });
    expect(mocks.tx.device.updateMany.mock.invocationCallOrder[1])
      .toBeLessThan(mocks.tx.harnessProject.upsert.mock.invocationCallOrder[0]);
  });

  it("rejects a legacy report after a versioned report has established capability 9", async () => {
    mocks.tx.device.findUnique
      .mockResolvedValueOnce({ agentReleaseVersion: "1.2.0", agentFeatureVersion: 8 })
      .mockResolvedValueOnce({ agentReleaseVersion: "1.2.1", agentFeatureVersion: 9 });

    expect((await POST(request(report()))).status).toBe(200);
    const stale = await POST(request(report({ agent: undefined })));

    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "stale_agent_report" });
    expect(mocks.tx.harnessProject.upsert).toHaveBeenCalledOnce();
  });

  it("retries a serialization conflict at the device freshness fence", async () => {
    mocks.prisma.$transaction.mockRejectedValueOnce(Object.assign(new Error("serialization conflict"), { code: "P2034" }));

    const response = await POST(request(report()));

    expect(response.status).toBe(200);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.tx.harnessProject.upsert).toHaveBeenCalledOnce();
  });

  it("keeps identity-less legacy reports compatible until the device has capability 9", async () => {
    mocks.tx.device.findUnique.mockResolvedValueOnce({ agentReleaseVersion: "1.2.0", agentFeatureVersion: 8 });

    const response = await POST(request(report({ agent: undefined })));

    expect(response.status).toBe(200);
    expect(mocks.tx.harnessProject.upsert).toHaveBeenCalledOnce();
  });

  it("rejects an identified older reporter before capability 9", async () => {
    mocks.tx.device.findUnique.mockResolvedValueOnce({ agentReleaseVersion: "1.2.1", agentFeatureVersion: 8 });

    const response = await POST(
      request(report({ agent: { releaseVersion: "1.2.0", featureVersion: 8 } }))
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "stale_agent_report" });
    expect(mocks.tx.harnessProject.upsert).not.toHaveBeenCalled();
  });

  it("requires identity to repair an oversized stored capability", async () => {
    mocks.tx.device.findUnique.mockResolvedValueOnce({ agentReleaseVersion: "1.2.1", agentFeatureVersion: 1_000_001 });

    const stale = await POST(request(report({ agent: undefined })));

    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "stale_agent_report" });
    expect(mocks.tx.harnessProject.upsert).not.toHaveBeenCalled();

    mocks.tx.device.findUnique.mockResolvedValueOnce({ agentReleaseVersion: "1.2.1", agentFeatureVersion: 1_000_001 });
    const repaired = await POST(request(report()));

    expect(repaired.status).toBe(200);
    expect(mocks.tx.device.updateMany).toHaveBeenNthCalledWith(3, {
      where: { id: "device-1", userId: "user-1" },
      data: { agentReleaseVersion: "1.2.1", agentFeatureVersion: 9 }
    });
    expect(mocks.tx.harnessProject.upsert).toHaveBeenCalledOnce();
  });

  it.each([
    ["pre-release", { releaseVersion: "1.2.1-beta", featureVersion: 9 }, "invalid_agent_reporter"],
    ["unknown field", { releaseVersion: "1.2.1", featureVersion: 9, extra: true }, "unknown_field"],
    ["missing release", { featureVersion: 9 }, "invalid_agent_reporter"],
    ["missing capability", { releaseVersion: "1.2.1" }, "invalid_agent_reporter"],
    ["fractional capability", { releaseVersion: "1.2.1", featureVersion: 9.5 }, "invalid_agent_reporter"],
    ["negative capability", { releaseVersion: "1.2.1", featureVersion: -1 }, "invalid_agent_reporter"],
    ["oversized capability", { releaseVersion: "1.2.1", featureVersion: 1_000_001 }, "invalid_agent_reporter"]
  ])("rejects a malformed %s reporter before Prisma reads or writes", async (_label, agent, code) => {
    const response = await POST(request(report({ agent })));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code });
    expect(mocks.prisma.project.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.tx.harnessProject.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.harnessGate.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.harnessModeIntent.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.harnessDispatchRun.upsert).not.toHaveBeenCalled();
  });

  it("accepts a full report containing the live F001 title and phase gate", async () => {
    const response = await POST(
      request(
        report({
          gate: {
            id: "gate-1",
            kind: "phase_advance",
            batch: "BL-HARNESS-DETAIL-MODEINTENT",
            detail: "Awaiting verification",
            evidence: ["docs/test-reports/evidence.json"],
            raised_at: "2026-07-27T12:00:00.000Z",
            raised_by: "autodriver"
          }
        })
      )
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.harnessProject.upsert.mock.calls[0][0].create.features).toEqual([
      { id: "F001", title: F001_TITLE, status: "completed", executor: "generator" }
    ]);
    expect(mocks.tx.harnessGate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ gateId: "gate-1", kind: "phase_advance" })
      })
    );
  });

  it("accepts the persisted Coordinator Planner assignment and rejects null external roles", async () => {
    const coordinatorReport: any = report();
    coordinatorReport.state.modes.dispatch.assignments = {
      planner: null,
      generator: "builder-codex",
      evaluator: "reviewer-kimi"
    };
    const accepted = await POST(request(coordinatorReport));
    expect(accepted.status).toBe(200);

    const invalidReport: any = report();
    invalidReport.state.modes.dispatch.assignments = {
      planner: null,
      generator: null,
      evaluator: "reviewer-kimi"
    };
    const rejected = await POST(request(invalidReport));
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ code: "invalid_mode_snapshot" });
  });

  it("accepts an opaque local repoKey and the live slash title shapes", async () => {
    const titles = [
      "REST /v1/images/generations",
      "POST /api/trip/generate",
      "喜欢/不喜欢",
      "门禁/限制/计费"
    ];
    const response = await POST(
      request(
        report({
          repoKey: `local:sha256:${"A".repeat(64)}`,
          state: {
            status: "building",
            features: titles.map((title, index) => ({ id: `F00${index + 1}`, title, status: "pending", executor: "generator" }))
          },
          dispatchRuns: []
        })
      )
    );

    expect(response.status).toBe(200);
    expect(mocks.prisma.project.findFirst).toHaveBeenCalledWith({
      where: { userId: "user-1", repoKey: `local:sha256:${"a".repeat(64)}` },
      select: { id: true }
    });
    expect(mocks.tx.harnessProject.upsert.mock.calls[0][0].create.repoKey).toBe(`local:sha256:${"a".repeat(64)}`);
  });

  it.each([
    ["https://GitHub.com/Acme/Tokenizer.git", "github.com/acme/tokenizer"],
    ["git@GITHUB.com:Acme/Tokenizer.git", "github.com/acme/tokenizer"],
    ["ssh://git@github.com/Acme/Tokenizer.git", "github.com/acme/tokenizer"],
    ["git://github.com/Acme/Tokenizer.git", "github.com/acme/tokenizer"]
  ])("canonicalizes the %s report identity before any project lookup or upsert", async (rawRepoKey, repoKey) => {
    const response = await POST(request(report({ repoKey: rawRepoKey })));

    expect(response.status).toBe(200);
    expect(mocks.prisma.project.findFirst).toHaveBeenCalledWith({
      where: { userId: "user-1", repoKey },
      select: { id: true }
    });
    expect(mocks.tx.harnessProject.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deviceId_repoKey: { deviceId: "device-1", repoKey } },
        create: expect.objectContaining({ repoKey })
      })
    );
  });

  it("rekeys one owned legacy identity in place and reissues its stale relay", async () => {
    const legacyProject = { id: "legacy-project", userId: "user-1", repoKey: "git@GITHUB.com:Acme/Tokenizer.git" };
    mocks.tx.harnessProject.findMany.mockResolvedValueOnce([legacyProject]);
    mocks.tx.harnessProject.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "legacy-project", userId: "user-1" });
    mocks.tx.harnessProject.upsert.mockResolvedValueOnce({
      id: "legacy-project",
      userId: "user-1",
      batch: "BL-TEST"
    });

    const response = await POST(request(report({ repoKey: "https://github.com/Acme/Tokenizer.git" })));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ harnessProjectId: "legacy-project" });
    expect(mocks.tx.harnessProject.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", deviceId: "device-1" },
      select: { id: true, userId: true, repoKey: true }
    });
    expect(mocks.tx.harnessProject.update).toHaveBeenCalledWith({
      where: { id: "legacy-project" },
      data: { repoKey: "github.com/acme/tokenizer" }
    });
    expect(mocks.tx.harnessGate.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        userId: "user-1",
        harnessProjectId: "legacy-project",
        consumedAt: null,
        relayedAt: { not: null }
      },
      data: { relayedAt: null }
    });
    expect(mocks.tx.harnessProject.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deviceId_repoKey: { deviceId: "device-1", repoKey: "github.com/acme/tokenizer" } }
      })
    );
  });

  it("keeps a legacy history from blocking reports to an existing canonical project", async () => {
    mocks.tx.harnessProject.findMany.mockResolvedValueOnce([
      { id: "canonical-project", userId: "user-1", repoKey: "github.com/acme/tokenizer" },
      { id: "legacy-project", userId: "user-1", repoKey: "git@GITHUB.com:Acme/Tokenizer.git" }
    ]);

    const response = await POST(request(report({ repoKey: "https://github.com/Acme/Tokenizer.git" })));

    expect(response.status).toBe(200);
    expect(mocks.tx.harnessProject.update).not.toHaveBeenCalled();
    expect(mocks.tx.harnessProject.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deviceId_repoKey: { deviceId: "device-1", repoKey: "github.com/acme/tokenizer" } }
      })
    );
    expect(mocks.tx.harnessGate.updateMany).toHaveBeenCalledTimes(1);
  });

  it("reissues one approved legacy gate through the canonical project without changing its signature", async () => {
    mocks.tx.harnessProject.findMany.mockResolvedValueOnce([
      { id: "canonical-project", userId: "user-1", repoKey: "github.com/acme/tokenizer" },
      { id: "legacy-project", userId: "user-1", repoKey: "git@GITHUB.com:Acme/Tokenizer.git" }
    ]);
    mocks.tx.harnessGate.findMany.mockResolvedValueOnce([{ id: "legacy-gate", gateId: "gate-1" }]);
    mocks.tx.harnessGate.updateMany.mockResolvedValueOnce({ count: 1 });

    const response = await POST(request(report({ repoKey: "https://github.com/Acme/Tokenizer.git" })));

    expect(response.status).toBe(200);
    expect(mocks.tx.harnessGate.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        harnessProjectId: "legacy-project",
        decisionSig: { not: null },
        consumedAt: null
      },
      select: { id: true, gateId: true }
    });
    expect(mocks.tx.harnessGate.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: "legacy-gate",
        userId: "user-1",
        harnessProjectId: "legacy-project",
        decisionSig: { not: null },
        consumedAt: null
      },
      data: { harnessProjectId: "canonical-project", relayedAt: null }
    });
    expect(mocks.tx.harnessGate.updateMany.mock.calls[0][0].data).not.toHaveProperty("decisionSig");
  });

  it("does not reissue a legacy gate when the canonical project already has that gate ID", async () => {
    mocks.tx.harnessProject.findMany.mockResolvedValueOnce([
      { id: "canonical-project", userId: "user-1", repoKey: "github.com/acme/tokenizer" },
      { id: "legacy-project", userId: "user-1", repoKey: "git@GITHUB.com:Acme/Tokenizer.git" }
    ]);
    mocks.tx.harnessGate.findMany.mockResolvedValueOnce([{ id: "legacy-gate", gateId: "gate-1" }]);
    mocks.tx.harnessGate.findUnique.mockResolvedValueOnce({ id: "canonical-gate" });

    const response = await POST(request(report({ repoKey: "https://github.com/Acme/Tokenizer.git" })));

    expect(response.status).toBe(200);
    expect(mocks.tx.harnessGate.updateMany).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a canonical device identity belongs to another user", async () => {
    mocks.tx.harnessProject.findMany.mockResolvedValueOnce([
      { id: "legacy-project", userId: "user-1", repoKey: "git@GITHUB.com:Acme/Tokenizer.git" }
    ]);
    mocks.tx.harnessProject.findUnique.mockResolvedValueOnce({ id: "foreign-project", userId: "user-2" });

    const response = await POST(request(report({ repoKey: "https://github.com/Acme/Tokenizer.git" })));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "project_ownership_conflict" });
    expect(mocks.tx.harnessProject.update).not.toHaveBeenCalled();
    expect(mocks.tx.harnessProject.upsert).not.toHaveBeenCalled();
  });

  it("fails closed when more than one legacy alias matches the canonical identity", async () => {
    mocks.tx.harnessProject.findMany.mockResolvedValueOnce([
      { id: "legacy-https", userId: "user-1", repoKey: "https://github.com/Acme/Tokenizer.git" },
      { id: "legacy-ssh", userId: "user-1", repoKey: "git@GITHUB.com:Acme/Tokenizer.git" }
    ]);

    const response = await POST(request(report()));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "repo_identity_ambiguous" });
    expect(mocks.tx.harnessProject.update).not.toHaveBeenCalled();
    expect(mocks.tx.harnessProject.upsert).not.toHaveBeenCalled();
  });

  it("rejects a repoKey that becomes empty during canonicalization before Prisma access", async () => {
    const response = await POST(request(report({ repoKey: "https://" })));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_repo_key" });
    expect(mocks.prisma.project.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("falls back to the canonical repo identity after an exact report read misses", async () => {
    mocks.prisma.harnessProject.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "harness-project-1" });
    const response = await GET(
      new Request("http://localhost/api/harness/report?repoKey=git%40GITHUB.com%3AAcme%2FTokenizer.git") as never
    );

    expect(response.status).toBe(200);
    expect(mocks.prisma.harnessProject.findFirst).toHaveBeenNthCalledWith(1, {
      where: { deviceId: "device-1", userId: "user-1", repoKey: "git@GITHUB.com:Acme/Tokenizer.git" }
    });
    expect(mocks.prisma.harnessProject.findFirst).toHaveBeenNthCalledWith(2, {
      where: { deviceId: "device-1", userId: "user-1", repoKey: "github.com/acme/tokenizer" }
    });
  });

  it("returns a historical noncanonical report row before attempting canonical fallback", async () => {
    const historicalProject = { id: "legacy-project", repoKey: "git@GITHUB.com:Acme/Tokenizer.git" };
    mocks.prisma.harnessProject.findFirst.mockResolvedValueOnce(historicalProject);
    const response = await GET(
      new Request("http://localhost/api/harness/report?repoKey=git%40GITHUB.com%3AAcme%2FTokenizer.git") as never
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ project: historicalProject });
    expect(mocks.prisma.harnessProject.findFirst).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.harnessProject.findFirst).toHaveBeenCalledWith({
      where: { deviceId: "device-1", userId: "user-1", repoKey: "git@GITHUB.com:Acme/Tokenizer.git" }
    });
  });

  it("finds a unique historical alias when the report is requested by canonical identity", async () => {
    const historicalProject = { id: "legacy-project", repoKey: "git@GITHUB.com:Acme/Tokenizer.git" };
    mocks.prisma.harnessProject.findFirst.mockResolvedValueOnce(null);
    mocks.prisma.harnessProject.findMany.mockResolvedValueOnce([historicalProject]);

    const response = await GET(
      new Request("http://localhost/api/harness/report?repoKey=github.com%2Facme%2Ftokenizer") as never
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ project: historicalProject });
    expect(mocks.prisma.harnessProject.findFirst).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.harnessProject.findMany).toHaveBeenCalledWith({
      where: { deviceId: "device-1", userId: "user-1" }
    });
  });

  it("does not choose between multiple historical aliases on a canonical report read", async () => {
    mocks.prisma.harnessProject.findFirst.mockResolvedValueOnce(null);
    mocks.prisma.harnessProject.findMany.mockResolvedValueOnce([
      { id: "legacy-https", repoKey: "https://github.com/Acme/Tokenizer.git" },
      { id: "legacy-ssh", repoKey: "git@GITHUB.com:Acme/Tokenizer.git" }
    ]);

    const response = await GET(
      new Request("http://localhost/api/harness/report?repoKey=github.com%2Facme%2Ftokenizer") as never
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ project: null });
  });

  it.each([
    "/Users/alice/private/repo",
    "//server/share",
    "//api/x",
    "x //host/share y",
    "POST /api/../private",
    "C:\\Users\\alice\\private",
    "\\\\server\\share\\private",
    "file:///private/repo",
    "stdout: raw output",
    "api_key=top-secret",
    "first line\nsecond line"
  ])("rejects sensitive feature titles before Prisma access", async (title) => {
    const response = await POST(
      request(report({ state: { status: "building", features: [{ id: "F003", title, status: "pending", executor: "generator" }] } }))
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ code: "sensitive_summary_data" });
    expect(JSON.stringify(body)).not.toContain(title);
    expect(mocks.prisma.project.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects unknown report, state, feature, and lastHalt fields before the first business query", async () => {
    const invalidReports = [
      report({ prompt: "raw prompt" }),
      report({ state: { status: "building", unexpected: true } }),
      report({ state: { status: "building", features: [{ id: "F003", prompt: "raw prompt" }] } }),
      report({ state: { status: "building", lastHalt: { condition: "timeout", source: "raw source" } } })
    ];

    for (const invalidReport of invalidReports) {
      vi.clearAllMocks();
      mocks.authenticateDeviceToken.mockResolvedValue({ userId: "user-1", deviceId: "device-1" });
      const response = await POST(request(invalidReport));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "unknown_field" });
      expect(mocks.prisma.project.findFirst).not.toHaveBeenCalled();
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
      expect(mocks.tx.harnessProject.findUnique).not.toHaveBeenCalled();
      expect(mocks.tx.harnessProject.upsert).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["raw channel", "stdout: raw output"],
    ["Unix path", "failed at /srv/private/repo"],
    ["Windows path", "failed at D:\\private\\repo"],
    ["UNC path", "failed at \\\\server\\share\\repo"],
    ["newline", "first line\nsecond line"],
    ["credential", "Bearer secret-token-value"]
  ])("rejects %s in the persisted mode snapshot without echoing it", async (_label, issue) => {
    const unsafeModes = modes();
    unsafeModes.dispatch.issues = [issue];
    const response = await POST(request(report({ state: { status: "building", modes: unsafeModes } })));
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain(issue);
    expect(mocks.prisma.project.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("persists the complete validated ModeSnapshot without reshaping it", async () => {
    const snapshot = modes();
    const response = await POST(request(report({ state: { status: "building", modes: snapshot } })));
    expect(response.status).toBe(200);
    expect(mocks.tx.harnessProject.upsert.mock.calls[0][0].create.modes).toEqual(snapshot);
    expect(mocks.tx.harnessProject.upsert.mock.calls[0][0].update.modes).toEqual(snapshot);
  });

  it("persists the exact legacy empty tool catalog report and refreshes reportedAt", async () => {
    const snapshot = legacyEmptyToolCatalogModes();
    const response = await POST(request(report({ state: { status: "building", modes: snapshot } })));

    expect(response.status).toBe(200);
    const upsert = mocks.tx.harnessProject.upsert.mock.calls[0][0];
    expect(upsert.create.modes).toEqual(snapshot);
    expect(upsert.update.modes).toEqual(snapshot);
    expect(upsert.create.reportedAt).toBeInstanceOf(Date);
    expect(upsert.update.reportedAt).toBe(upsert.create.reportedAt);
  });

  it.each([
    ["disabled non-empty catalog", () => [{ tool: "codex" }]],
    ["disabled non-array catalog", () => ({})],
    ["enabled non-array catalog", () => ({}), true]
  ])("rejects %s before Prisma access", async (_label, catalog, enabled = false) => {
    const snapshot = legacyEmptyToolCatalogModes();
    snapshot.dispatch.enabled = enabled;
    snapshot.dispatch.toolCatalog = catalog() as never;

    const response = await POST(request(report({ state: { status: "building", modes: snapshot } })));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "invalid_tool_catalog" });
    expect(mocks.prisma.project.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.tx.harnessProject.upsert).not.toHaveBeenCalled();
  });

  it("persists a catalog-only Coordinator-native subagent report as an observation", async () => {
    const snapshot: any = modes();
    snapshot.dispatch.integrations = [{
      id: "codex",
      tool: "codex",
      label: "Codex",
      modelFamily: "codex",
      roles: ["generator"],
      invocations: ["subagent"],
      capabilities: ["build"],
      localCli: false,
      subagent: true,
      a2aTargetCount: 0,
      sandboxed: false
    }];
    snapshot.dispatch.toolCatalog = [{
      tool: "codex",
      label: "Codex",
      invocation: "subagent",
      role: "generator",
      agentCount: 1,
      modelFamilies: ["codex"],
      capabilities: ["build"]
    }];
    const response = await POST(request(report({ state: { status: "building", modes: snapshot } })));
    expect(response.status).toBe(200);
    expect(mocks.prisma.project.findFirst).toHaveBeenCalled();
    expect(mocks.tx.harnessProject.upsert.mock.calls[0][0].create.modes).toEqual(snapshot);
  });

  it.each([
    ["unknown dispatch field", (snapshot: ReturnType<typeof legacyEmptyToolCatalogModes>) => {
      Object.assign(snapshot.dispatch, { source: "raw" });
    }, "unknown_field"],
    ["sensitive dispatch issue", (snapshot: ReturnType<typeof legacyEmptyToolCatalogModes>) => {
      snapshot.dispatch.issues = ["api_key=top-secret"];
    }, "sensitive_summary_data"]
  ])("keeps %s fail-closed before Prisma access", async (_label, mutate, code) => {
    const snapshot = legacyEmptyToolCatalogModes();
    mutate(snapshot);

    const response = await POST(request(report({ state: { status: "building", modes: snapshot } })));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code });
    expect(mocks.prisma.project.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.tx.harnessProject.upsert).not.toHaveBeenCalled();
  });

  it("fails closed before upsert when the unique device+repo project belongs to another user", async () => {
    mocks.tx.harnessProject.findUnique.mockResolvedValueOnce({ id: "foreign-project", userId: "user-2" });
    const response = await POST(request(report()));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "harness project ownership conflict",
      code: "project_ownership_conflict"
    });
    expect(mocks.tx.harnessProject.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.harnessGate.findUnique).not.toHaveBeenCalled();
    expect(mocks.tx.harnessModeIntent.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.harnessDispatchRun.upsert).not.toHaveBeenCalled();
  });

  it("upserts duplicate reports by the same project+runId instead of creating an unscoped row", async () => {
    await POST(request(report()));
    await POST(request(report()));
    expect(mocks.tx.harnessDispatchRun.upsert).toHaveBeenCalledTimes(2);
    for (const call of mocks.tx.harnessDispatchRun.upsert.mock.calls) {
      expect(call[0]).toMatchObject({
        where: {
          harnessProjectId_runId: { harnessProjectId: "harness-project-1", runId: "run-1" }
        },
        create: {
          userId: "user-1",
          harnessProjectId: "harness-project-1",
          runId: "run-1"
        },
        update: { taskId: "task-1", lockedSha: HEAD }
      });
    }
  });

  it("advances only the matching owned intent and does not write progress or roles", async () => {
    const response = await POST(request(report()));
    expect(response.status).toBe(200);
    expect(mocks.tx.harnessModeIntent.updateMany.mock.calls[0][0]).toMatchObject({
      where: {
        userId: "user-1",
        harnessProjectId: "harness-project-1",
        intentId: "intent-1",
        status: { in: ["issued", "relayed"] }
      },
      data: { status: "staged", stagedCommitSha: HEAD }
    });
    expect(mocks.tx.harnessModeIntent.updateMany.mock.calls[1][0]).toMatchObject({
      where: {
        userId: "user-1",
        harnessProjectId: "harness-project-1",
        intentId: "intent-1",
        status: { in: ["issued", "relayed", "staged"] }
      },
      data: { status: "applied", appliedBatch: "BL-NEXT" }
    });
    const projectWrite = mocks.tx.harnessProject.upsert.mock.calls[0][0];
    expect(projectWrite.create).not.toHaveProperty("roleAssignments");
    expect(projectWrite.update).not.toHaveProperty("roleAssignments");
    expect(projectWrite.update).not.toHaveProperty("modeIntent");
  });

  it("preserves old-agent compatibility when all F003 fields are absent", async () => {
    const response = await POST(
      request({
        repoKey: "github.com/acme/tokenizer",
        name: "tokenizer",
        state: { status: "building", headSha: "0123456" },
        gate: null
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.tx.harnessModeIntent.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.harnessDispatchRun.upsert).not.toHaveBeenCalled();
  });

  it("keeps the existing gate upsert path tenant-owned", async () => {
    const response = await POST(
      request(
        report({
          state: { status: "building", headSha: HEAD },
          dispatchRuns: [],
          gate: {
            id: "gate-1",
            kind: "phase_advance",
            batch: "BL-TEST",
            detail: "Awaiting verification",
            evidence: ["docs/test-reports/evidence.json"],
            raised_at: "2026-07-27T12:00:00.000Z",
            raised_by: "autodriver"
          }
        })
      )
    );
    expect(response.status).toBe(200);
    expect(mocks.tx.harnessGate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          userId: "user-1",
          harnessProjectId: "harness-project-1",
          gateId: "gate-1"
        })
      })
    );
  });
});
