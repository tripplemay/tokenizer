import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    harnessProject: { findUnique: vi.fn(), upsert: vi.fn() },
    harnessGate: { findUnique: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    harnessModeIntent: { updateMany: vi.fn() },
    harnessDispatchRun: { upsert: vi.fn() }
  };
  return {
    authenticateDeviceToken: vi.fn(),
    tx,
    prisma: {
      project: { findFirst: vi.fn() },
      $transaction: vi.fn(),
      harnessProject: { findFirst: vi.fn() }
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
    mocks.authenticateDeviceToken.mockResolvedValue({ userId: "user-1", deviceId: "device-1" });
    mocks.prisma.project.findFirst.mockResolvedValue({ id: "usage-project-1" });
    mocks.tx.harnessProject.findUnique.mockResolvedValue(null);
    mocks.tx.harnessProject.upsert.mockResolvedValue({
      id: "harness-project-1",
      userId: "user-1",
      batch: "BL-TEST"
    });
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
      mocks.authenticateDeviceToken.mockResolvedValue({ userId: "user-1", deviceId: "device-1" });
      const response = await POST(request(report({ dispatchRuns: [invalidRun] })));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(JSON.stringify(body)).not.toContain("raw prompt");
      expect(JSON.stringify(body)).not.toContain("/Users/alice");
      expect(mocks.prisma.project.findFirst).not.toHaveBeenCalled();
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    }
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
          repoKey: `local:sha256:${"a".repeat(64)}`,
          state: {
            status: "building",
            features: titles.map((title, index) => ({ id: `F00${index + 1}`, title, status: "pending", executor: "generator" }))
          },
          dispatchRuns: []
        })
      )
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.harnessProject.upsert.mock.calls[0][0].create.repoKey).toBe(`local:sha256:${"a".repeat(64)}`);
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
