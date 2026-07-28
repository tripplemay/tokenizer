import { describe, expect, it } from "vitest";
import {
  HarnessApiInputError,
  isIdenticalRelayAck,
  modeAgentsFromSnapshot,
  parseDispatchRuns,
  parseModeSnapshot,
  parseRelayModeIntentAck,
  parseUtcDate,
  relayAckSourceStatuses,
  safePersistedSummary
} from "@/server/harness-mode-intent-api";

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const SHA256 = "a".repeat(64);

function modeSnapshot() {
  return {
    framework: {
      version: "1.4.7",
      commit: HEAD,
      adopted: true,
      managedCount: 120,
      drift: { ok: 119, modified: 1, missing: 0, customized: 0 },
      scanned: true
    },
    execution: "heterogeneous",
    autonomy: {
      enabled: false,
      policyValid: null,
      authorizedBy: null,
      expiresAt: null,
      status: null
    },
    dispatch: {
      enabled: true,
      assignments: { generator: "builder-codex", evaluator: "reviewer-kimi" },
      agents: [
        {
          id: "builder-codex",
          roles: ["generator"],
          transport: "local-cli",
          modelFamily: "codex",
          adapter: "codex",
          sandboxed: true,
          capabilities: ["build", "fix"]
        }
      ],
      familyExclusive: true,
      issues: []
    },
    gate: { pubInstalled: true, guardMode: "signature", pendingGateId: null },
    machinery: { denyListMerged: true, hooks: ["dispatch"], missing: [] },
    pendingDefaults: {
      intentId: "intent-1",
      stagedAt: "2026-07-27T12:00:00.000Z",
      intentExpiresAt: "2026-07-28T12:00:00.000Z",
      execution: {
        profile: "heterogeneous",
        roleAssignments: { generator: "builder-codex", evaluator: "reviewer-kimi" }
      },
      autonomy: { enabled: false, expiresAt: null }
    }
  };
}

function dispatchRun(overrides: Record<string, unknown> = {}) {
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
    artifactPath: "docs/test-reports/handoff.json",
    artifactSha256: SHA256,
    errorSummary: null,
    ...overrides
  };
}

describe("mode snapshot extraction", () => {
  it("converts the reported camelCase agent snapshot into F002 descriptors", () => {
    const agents = modeAgentsFromSnapshot({
      dispatch: {
        enabled: true,
        agents: [
          {
            id: "builder-codex",
            roles: ["generator"],
            transport: "local-cli",
            modelFamily: "codex",
            adapter: "codex",
            sandboxed: true,
            capabilities: ["build", "fix"]
          },
          {
            id: "reviewer-kimi",
            roles: ["evaluator"],
            transport: "a2a",
            modelFamily: "kimi"
          }
        ]
      }
    });
    expect(agents).toEqual([
      {
        id: "builder-codex",
        roles: ["generator"],
        transport: "local-cli",
        model_family: "codex"
      },
      { id: "reviewer-kimi", roles: ["evaluator"], transport: "a2a", model_family: "kimi" }
    ]);
  });

  it("rejects absent, disabled, empty, duplicate, or malformed snapshots", () => {
    expect(() => modeAgentsFromSnapshot(null)).toThrow(HarnessApiInputError);
    expect(() => modeAgentsFromSnapshot({ dispatch: { enabled: false, agents: [] } })).toThrow(/usable/);
    expect(() =>
      modeAgentsFromSnapshot({
        dispatch: {
          enabled: true,
          agents: [
            { id: "same", roles: ["generator"], transport: "subagent", modelFamily: "one" },
            { id: "same", roles: ["evaluator"], transport: "subagent", modelFamily: "two" }
          ]
        }
      })
    ).toThrow(/duplicate/);
  });
});

describe("report timestamp validation", () => {
  it.each([
    ["no fraction", "2026-07-27T12:00:00Z", "2026-07-27T12:00:00.000Z"],
    ["one fractional digit", "2026-07-27T12:00:00.1Z", "2026-07-27T12:00:00.100Z"],
    ["two fractional digits", "2026-07-27T12:00:00.12Z", "2026-07-27T12:00:00.120Z"],
    ["long fraction", "2026-07-27T12:00:00.123456Z", "2026-07-27T12:00:00.123Z"]
  ])("accepts %s", (_label, value, expected) => {
    expect(parseUtcDate(value, "timestamp").toISOString()).toBe(expected);
  });

  it.each(["2026-02-29T12:00:00Z", "2026-13-01T12:00:00Z", "2026-07-27T24:00:00Z"])(
    "rejects invalid calendar timestamp %s",
    (value) => expect(() => parseUtcDate(value, "timestamp")).toThrow(/valid calendar/)
  );
});

describe("persisted feature title redaction", () => {
  it("accepts the live F001 title with its exact Harness command reference", () => {
    expect(
      safePersistedSummary(
        "Harness 通用契约：签名 mode defaults、/plan 消费与 dispatch 摘要落点",
        "feature.title",
        256
      )
    ).toBe("Harness 通用契约：签名 mode defaults、/plan 消费与 dispatch 摘要落点");
  });

  it.each(["/plan", "/build", "/verify", "/dashboard", "/autodrive"])(
    "accepts the exact known Harness command %s in a feature title",
    (command) => {
      expect(safePersistedSummary(`Harness command ${command} reference`, "feature.title", 256)).toBe(
        `Harness command ${command} reference`
      );
    }
  );

  it.each([
    ["nested path", "Harness command /plan/private"],
    ["path-shaped extension", "Harness command /plan.txt"],
    ["path-shaped suffix", "Harness command /plan-private"],
    ["unknown slash command", "Harness command /unknown"],
    ["arbitrary absolute path", "Harness command /tmp"],
    ["POSIX path beside command", "Harness /plan state at /srv/private/repo"],
    ["Windows path beside command", "Harness /plan state at D:\\private\\repo"],
    ["UNC path beside command", "Harness /plan state at \\\\server\\share\\repo"],
    ["file URL beside command", "Harness /plan state at file:///private/repo"],
    ["raw prompt beside command", "Harness /plan prompt: raw input"],
    ["raw channel beside command", "Harness /plan stdout: raw output"],
    ["raw stderr beside command", "Harness /plan stderr=raw error"],
    ["raw env beside command", "Harness /plan env: SECRET=value"],
    ["raw log beside command", "Harness /plan log: raw output"],
    ["raw source beside command", "Harness /plan source: raw code"],
    ["credential beside command", "Harness /plan password=top-secret-value"],
    ["newline beside command", "Harness /plan\nraw output"]
  ])("rejects %s", (_label, title) => {
    expect(() => safePersistedSummary(title, "feature.title", 256)).toThrow(/may not be persisted/);
  });

  it.each(["errorSummary", "verdict", "state.modes.dispatch.issues item"])(
    "does not allow the same command reference in strict %s data",
    (label) => {
      expect(() => safePersistedSummary("/plan", label, 256)).toThrow(/may not be persisted/);
    }
  );
});

describe("persisted mode snapshot validation", () => {
  it("preserves the complete existing ModeSnapshot shape", () => {
    const snapshot = modeSnapshot();
    expect(parseModeSnapshot(snapshot)).toBe(snapshot);
  });

  it.each([
    ["raw output", "stdout: full command output"],
    ["Harness command reference", "/plan"],
    ["Unix absolute path", "failed under /srv/private/repo"],
    ["Windows absolute path", "failed under D:\\private\\repo"],
    ["UNC absolute path", "failed under \\\\server\\share\\repo"],
    ["newline", "first line\nsecond line"],
    ["credential", "api_key=top-secret-value"]
  ])("rejects %s embedded in an otherwise exact snapshot", (_label, issue) => {
    const snapshot = modeSnapshot();
    snapshot.dispatch.issues = [issue];
    expect(() => parseModeSnapshot(snapshot)).toThrow(/may not be persisted/);
  });

  it("rejects unknown nested mode keys instead of silently stripping them", () => {
    expect(() => parseModeSnapshot({ ...modeSnapshot(), stdout: "raw" })).toThrow(/unsupported/);
  });

  it("keeps accepting old agent v3 snapshots without F004 fields", () => {
    const { pendingDefaults: _pendingDefaults, ...oldSnapshot } = modeSnapshot();
    delete (oldSnapshot.dispatch.agents[0] as { capabilities?: string[] }).capabilities;
    expect(parseModeSnapshot(oldSnapshot)).toBe(oldSnapshot);
  });

  it("fully validates every present F004 field", () => {
    const sensitive = modeSnapshot();
    sensitive.dispatch.agents[0].capabilities = ["env=secret"];
    expect(() => parseModeSnapshot(sensitive)).toThrow(/may not be persisted/);

    const tooManyCapabilities = modeSnapshot();
    tooManyCapabilities.dispatch.agents[0].capabilities = Array.from({ length: 33 }, (_, index) => `cap-${index}`);
    expect(() => parseModeSnapshot(tooManyCapabilities)).toThrow(/bounded array/);

    const unknownDefaultsField = modeSnapshot();
    Object.assign(unknownDefaultsField.pendingDefaults, { stdout: "raw" });
    expect(() => parseModeSnapshot(unknownDefaultsField)).toThrow(/unsupported/);
  });

  it("enforces pending profile assignments and staging-before-expiry ordering", () => {
    const fastWithAssignments = modeSnapshot();
    fastWithAssignments.pendingDefaults.execution.profile = "fast";
    expect(() => parseModeSnapshot(fastWithAssignments)).toThrow(/fast profile requires null/);

    const heterogeneousWithoutAssignments = modeSnapshot();
    heterogeneousWithoutAssignments.pendingDefaults.execution.roleAssignments = null;
    expect(() => parseModeSnapshot(heterogeneousWithoutAssignments)).toThrow(/require roleAssignments/);

    const reversedWindow = modeSnapshot();
    reversedWindow.pendingDefaults.stagedAt = reversedWindow.pendingDefaults.intentExpiresAt;
    expect(() => parseModeSnapshot(reversedWindow)).toThrow(/must precede/);
  });
});

describe("relay ACK validation", () => {
  it("accepts legal bounded ACK shapes and exposes their source states", () => {
    const staged = parseRelayModeIntentAck({
      projectId: "project-1",
      intentId: "intent-1",
      status: "staged",
      stagedAt: "2026-07-27T12:00:00.000Z",
      stagedCommitSha: HEAD.toUpperCase()
    });
    expect(staged).toMatchObject({ status: "staged", stagedCommitSha: HEAD });
    expect(relayAckSourceStatuses("staged")).toEqual(["issued", "relayed"]);
    expect(relayAckSourceStatuses("applied")).toEqual(["staged"]);
    expect(relayAckSourceStatuses("failed")).toEqual(["issued", "relayed", "staged"]);
  });

  it("recognizes only an identical retry of the same state", () => {
    const ack = parseRelayModeIntentAck({
      projectId: "project-1",
      intentId: "intent-1",
      status: "applied",
      appliedAt: "2026-07-27T12:00:00.000Z",
      appliedBatch: "BL-NEXT"
    });
    expect(
      isIdenticalRelayAck(
        { status: "applied", appliedAt: new Date("2026-07-27T12:00:00.000Z"), appliedBatch: "BL-NEXT" },
        ack
      )
    ).toBe(true);
    expect(
      isIdenticalRelayAck(
        { status: "applied", appliedAt: new Date("2026-07-27T12:00:00.000Z"), appliedBatch: "OTHER" },
        ack
      )
    ).toBe(false);
  });

  it("rejects unknown fields, oversized failure metadata, and raw secret/output channels", () => {
    expect(() =>
      parseRelayModeIntentAck({
        projectId: "p",
        intentId: "i",
        status: "failed",
        failedAt: "2026-07-27T12:00:00.000Z",
        failureCode: "git_failed",
        failureDetail: "stderr=/Users/alice/private.log"
      })
    ).toThrow(/may not be persisted/);
    expect(() =>
      parseRelayModeIntentAck({
        projectId: "p",
        intentId: "i",
        status: "staged",
        stagedAt: "2026-07-27T12:00:00.000Z",
        payload: "secret"
      })
    ).toThrow(/unsupported/);
  });
});

describe("dispatch summary allowlist and redaction", () => {
  it("normalizes an allowlisted summary", () => {
    expect(parseDispatchRuns([dispatchRun()])).toEqual([
      expect.objectContaining({
        runId: "run-1",
        lockedSha: HEAD,
        durationMs: 1_000,
        artifactPath: "docs/test-reports/handoff.json",
        artifactSha256: SHA256
      })
    ]);
  });

  it.each([
    ["unknown raw prompt field", dispatchRun({ prompt: "raw prompt" })],
    ["unknown stdout field", dispatchRun({ stdout: "raw output" })],
    ["absolute POSIX artifact", dispatchRun({ artifactPath: "/Users/alice/result.json" })],
    ["Windows artifact", dispatchRun({ artifactPath: "C:\\temp\\result.json" })],
    ["path traversal", dispatchRun({ artifactPath: "docs/../secret.json" })],
    ["worktree path", dispatchRun({ artifactPath: ".worktrees/task/result.json" })],
    ["raw env summary", dispatchRun({ errorSummary: "env: API_KEY=secret" })],
    ["Harness command error summary", dispatchRun({ errorSummary: "/plan" })],
    ["absolute path summary", dispatchRun({ errorSummary: "failed at /home/alice/repo" })],
    ["Harness command verdict", dispatchRun({ verdict: "/plan" })],
    ["absolute path verdict", dispatchRun({ verdict: "failed at /srv/agent/repo" })],
    ["Windows path verdict", dispatchRun({ verdict: "failed at D:\\agent\\repo" })],
    ["UNC path verdict", dispatchRun({ verdict: "failed at \\\\server\\share\\repo" })],
    ["newline verdict", dispatchRun({ verdict: "FAILED\nraw output" })],
    ["raw channel verdict", dispatchRun({ verdict: "prompt: secret task" })],
    ["credential verdict", dispatchRun({ verdict: "password=hunter2" })],
    ["token verdict", dispatchRun({ verdict: "token=top-secret-value" })],
    ["short locked sha", dispatchRun({ lockedSha: "abc1234" })],
    ["bad artifact digest", dispatchRun({ artifactSha256: "abc" })],
    ["negative duration", dispatchRun({ durationMs: -1 })],
    [
      "reversed dates",
      dispatchRun({ startedAt: "2026-07-27T12:00:02.000Z", finishedAt: "2026-07-27T12:00:01.000Z" })
    ],
    ["unknown role", dispatchRun({ role: "planner" })],
    ["unknown transport", dispatchRun({ transport: "ssh" })]
  ])("rejects %s", (_label, value) => {
    expect(() => parseDispatchRuns([value])).toThrow(HarnessApiInputError);
  });

  it("rejects duplicate run ids and more than 50 summaries", () => {
    expect(() => parseDispatchRuns([dispatchRun(), dispatchRun()])).toThrow(/duplicate/);
    expect(() => parseDispatchRuns(Array.from({ length: 51 }, (_, index) => dispatchRun({ runId: `run-${index}` })))).toThrow(
      /at most 50/
    );
  });
});
