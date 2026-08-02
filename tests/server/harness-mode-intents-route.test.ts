import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    harnessModeIntent: { updateMany: vi.fn(), create: vi.fn() }
  };
  return {
    auth: vi.fn(),
    signHarnessPayload: vi.fn(),
    tx,
    prisma: {
      harnessProject: { findFirst: vi.fn() },
      harnessModeIntent: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
      $transaction: vi.fn()
    }
  };
});

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/server/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/server/harness-sign", () => ({ signHarnessPayload: mocks.signHarnessPayload }));

import { DELETE, GET, POST } from "../../app/api/harness/mode-intents/route";
import {
  MIN_MODE_INTENT_AGENT_FEATURE_VERSION,
  MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION
} from "@/shared/agent-feature-version";

const HEAD = "0123456789abcdef0123456789abcdef01234567";

function toolCatalog() {
  return [
    {
      tool: "kimi",
      label: "Kimi",
      invocation: "local-cli",
      role: "planner",
      agentCount: 1,
      modelFamilies: ["kimi"],
      capabilities: ["plan"]
    },
    {
      tool: "codex",
      label: "Codex",
      invocation: "local-cli",
      role: "generator",
      agentCount: 1,
      modelFamilies: ["codex"],
      capabilities: ["build"]
    },
    {
      tool: "kimi",
      label: "Kimi",
      invocation: "local-cli",
      role: "evaluator",
      agentCount: 1,
      modelFamilies: ["kimi"],
      capabilities: ["verify"]
    }
  ];
}

function v2Desired() {
  return {
    execution: {
      profile: "heterogeneous",
      role_bindings: {
        planner: null,
        generator: { tool: "codex", invocation: "local-cli" },
        evaluator: { tool: "kimi", invocation: "local-cli" }
      }
    },
    autonomy: { enabled: false }
  };
}

function v2FastDesired() {
  return {
    execution: { profile: "fast", role_bindings: null },
    autonomy: { enabled: false }
  };
}

function enabledAutonomyDesired(overrides: Record<string, unknown> = {}) {
  return {
    execution: { profile: "fast", role_assignments: null },
    autonomy: {
      enabled: true,
      expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      auto_cross: ["A"],
      budget: { max_tokens: 50_000, max_cost_usd: 20, max_wakes: 8, max_fix_rounds: 2 },
      ...overrides
    }
  };
}

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: "project-1",
    repoKey: "github.com/acme/tokenizer",
    headSha: HEAD,
    reportedAt: new Date(),
    modes: {
      dispatch: {
        enabled: true,
        agents: [
          { id: "builder-codex", roles: ["generator"], transport: "local-cli", modelFamily: "codex" },
          { id: "reviewer-kimi", roles: ["evaluator"], transport: "a2a", modelFamily: "kimi" }
        ],
        toolCatalog: toolCatalog()
      }
    },
    device: { userId: "user-1", agentFeatureVersion: MIN_MODE_INTENT_AGENT_FEATURE_VERSION },
    ...overrides
  };
}

function issueRequest(desired: unknown = { execution: { profile: "fast", role_assignments: null }, autonomy: { enabled: false } }) {
  return new Request("http://localhost/api/harness/mode-intents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectId: "project-1",
      desired,
      intentExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    })
  });
}

function issueRequestWithRawDesired(rawDesired: string) {
  return new Request("http://localhost/api/harness/mode-intents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: `{"projectId":"project-1","desired":${rawDesired},"intentExpiresAt":"${new Date(Date.now() + 60 * 60 * 1000).toISOString()}"}`
  });
}

function createdIntent() {
  const issuedAt = new Date();
  return {
    id: "row-1",
    intentId: "intent-1",
    payload: { intent_id: "intent-1" },
    signature: "signed",
    status: "issued",
    issuedBy: "owner@example.test",
    issuedAt,
    intentExpiresAt: new Date(issuedAt.getTime() + 60_000),
    relayedAt: null,
    stagedAt: null,
    appliedAt: null,
    failedAt: null,
    appliedBatch: null,
    stagedCommitSha: null,
    failureCode: null,
    failureDetail: null
  };
}

describe("session mode intent route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1", email: "owner@example.test", name: "Owner" } });
    mocks.prisma.harnessProject.findFirst.mockResolvedValue(project());
    mocks.prisma.harnessModeIntent.findMany.mockResolvedValue([]);
    mocks.signHarnessPayload.mockReturnValue("signed");
    mocks.tx.harnessModeIntent.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.harnessModeIntent.create.mockResolvedValue(createdIntent());
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx));
  });

  it("requires a session and scopes history by both project and session user", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    expect((await GET(new Request("http://localhost/api/harness/mode-intents?projectId=project-1"))).status).toBe(401);
    expect(mocks.prisma.harnessProject.findFirst).not.toHaveBeenCalled();

    await GET(new Request("http://localhost/api/harness/mode-intents?projectId=project-1"));
    expect(mocks.prisma.harnessProject.findFirst).toHaveBeenCalledWith({
      where: { id: "project-1", userId: "user-1" },
      select: { id: true }
    });
    expect(mocks.prisma.harnessModeIntent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { harnessProjectId: "project-1", userId: "user-1" } })
    );
  });

  it("returns 404 for a foreign project without querying intent history", async () => {
    mocks.prisma.harnessProject.findFirst.mockResolvedValueOnce(null);
    const response = await GET(new Request("http://localhost/api/harness/mode-intents?projectId=foreign"));
    expect(response.status).toBe(404);
    expect(mocks.prisma.harnessModeIntent.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ["stale report", project({ reportedAt: new Date(Date.now() - 21 * 60 * 1000) }), "stale_report"],
    ["old agent", project({ device: { userId: "user-1", agentFeatureVersion: MIN_MODE_INTENT_AGENT_FEATURE_VERSION - 1 } }), "agent_upgrade_required"],
    ["short HEAD", project({ headSha: "0123456" }), "invalid_project_head"],
    ["missing snapshot", project({ modes: null }), "invalid_mode_snapshot"]
  ])("rejects %s before signing or writing", async (_label, fixture, code) => {
    mocks.prisma.harnessProject.findFirst.mockResolvedValueOnce(fixture);
    const response = await POST(issueRequest());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe(code);
    expect(mocks.signHarnessPayload).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("validates role/family/transport selection against the reported snapshot", async () => {
    const response = await POST(
      issueRequest({
        execution: {
          profile: "heterogeneous",
          role_assignments: { generator: "builder-codex", evaluator: "builder-codex" }
        },
        autonomy: { enabled: false }
      })
    );
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("duplicate_agent");
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("normalizes cent-denominated autonomy cost before signing", async () => {
    const response = await POST(issueRequest(enabledAutonomyDesired({
      budget: { max_tokens: 50_000, max_cost_usd: 0.29, max_wakes: 8, max_fix_rounds: 2 }
    })));

    expect(response.status).toBe(201);
    expect(mocks.signHarnessPayload).toHaveBeenCalledWith(expect.objectContaining({
      desired: expect.objectContaining({
        autonomy: expect.objectContaining({ budget: expect.objectContaining({ max_cost_usd: 0.29 }) })
      })
    }));
  });

  it.each([
    ["fractional cent", enabledAutonomyDesired({ budget: { max_tokens: 50_000, max_cost_usd: 1.234, max_wakes: 8, max_fix_rounds: 2 } })],
    ["unstable wake key", enabledAutonomyDesired({ wake_interval_s: { "build phase": 60 } })],
    ["prototype-mutating wake key", enabledAutonomyDesired({ wake_interval_s: JSON.parse('{"__proto__":60}') })]
  ])("rejects %s before signing", async (_label, desired) => {
    const response = await POST(issueRequest(desired));
    expect(response.status).toBe(400);
    expect(mocks.signHarnessPayload).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a raw negative-zero JSON token before signing", async () => {
    const desired = JSON.stringify(enabledAutonomyDesired({
      budget: { max_tokens: 50_000, max_cost_usd: 0, max_wakes: 8, max_fix_rounds: 2 }
    })).replace('"max_cost_usd":0', '"max_cost_usd":-0');
    const response = await POST(issueRequestWithRawDesired(desired));
    expect(response.status).toBe(400);
    expect(mocks.signHarnessPayload).not.toHaveBeenCalled();
  });

  it("gates v2 role bindings at feature v8 and signs the catalog's canonical tool ids", async () => {
    mocks.prisma.harnessProject.findFirst.mockResolvedValueOnce(project({
      device: { userId: "user-1", agentFeatureVersion: MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION - 1 }
    }));
    const oldAgent = await POST(issueRequest(v2Desired()));
    expect(oldAgent.status).toBe(409);
    expect((await oldAgent.json()).code).toBe("tool_binding_agent_upgrade_required");
    expect(mocks.signHarnessPayload).not.toHaveBeenCalled();

    mocks.prisma.harnessProject.findFirst.mockResolvedValueOnce(project({
      device: { userId: "user-1", agentFeatureVersion: MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION }
    }));
    const response = await POST(issueRequest(v2Desired()));
    expect(response.status).toBe(201);
    expect(mocks.signHarnessPayload).toHaveBeenCalledWith(expect.objectContaining({
      desired: v2Desired()
    }));
  });

  it("refuses to sign report-shaped external bridge routes", async () => {
    const bridgeCatalog = [
      {
        tool: "kimi",
        label: "Kimi Code",
        invocation: "subagent",
        role: "planner",
        agentCount: 1,
        modelFamilies: ["kimi"],
        capabilities: ["plan", "build"]
      },
      {
        tool: "kimi",
        label: "Kimi Code",
        invocation: "subagent",
        role: "generator",
        agentCount: 1,
        modelFamilies: ["kimi"],
        capabilities: ["plan", "build"]
      },
      {
        tool: "future-cli",
        label: "Future CLI",
        invocation: "subagent",
        role: "evaluator",
        agentCount: 1,
        modelFamilies: ["future"],
        capabilities: ["verify"]
      }
    ];
    const desired = {
      execution: {
        profile: "heterogeneous",
        role_bindings: {
          planner: null,
          generator: { tool: "kimi", invocation: "subagent" },
          evaluator: { tool: "future-cli", invocation: "subagent" }
        }
      },
      autonomy: { enabled: false }
    };
    const integrations = [
      {
        id: "kimi",
        tool: "kimi",
        label: "Kimi Code",
        modelFamily: "kimi",
        roles: ["planner", "generator"],
        invocations: ["local-cli", "subagent"],
        capabilities: ["plan", "build"],
        localCli: true,
        subagent: true,
        bridgeId: "kimi-acp-native-agent",
        bridgeKind: "session-bridge-v1",
        sessionScope: "same-session",
        bridgeProtocol: "acp-native-agent/v1",
        bridgeCommand: ["kimi", "acp"],
        adapterBridgeCommand: ["kimi", "acp"],
        bridgeRoles: ["planner", "generator"],
        a2aTargetCount: 0,
        sandboxed: true
      },
      {
        id: "future-cli",
        tool: "future-cli",
        label: "Future CLI",
        modelFamily: "future",
        roles: ["evaluator"],
        invocations: ["local-cli", "subagent"],
        capabilities: ["verify"],
        localCli: true,
        subagent: true,
        bridgeId: "future-acp-native-agent",
        bridgeKind: "session-bridge-v1",
        sessionScope: "same-session",
        bridgeProtocol: "acp-native-agent/v1",
        bridgeCommand: ["future-cli", "acp"],
        adapterBridgeCommand: ["future-cli", "acp"],
        bridgeRoles: ["evaluator"],
        a2aTargetCount: 0,
        sandboxed: true
      }
    ];
    mocks.prisma.harnessProject.findFirst.mockResolvedValueOnce(project({
      device: { userId: "user-1", agentFeatureVersion: MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION },
      modes: { dispatch: { enabled: true, agents: [], integrations, toolCatalog: bridgeCatalog } }
    }));

    const response = await POST(issueRequest(desired));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("invalid_tool_catalog");
    expect(mocks.signHarnessPayload).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses v2 signing when the device has no usable tool catalog", async () => {
    mocks.prisma.harnessProject.findFirst.mockResolvedValueOnce(project({
      device: { userId: "user-1", agentFeatureVersion: MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION },
      modes: { dispatch: { enabled: true, agents: project().modes.dispatch.agents } }
    }));
    const response = await POST(issueRequest(v2Desired()));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("invalid_tool_catalog");
    expect(mocks.signHarnessPayload).not.toHaveBeenCalled();
  });

  it("refuses v2 signing from a catalog-only Codex subagent claim", async () => {
    mocks.prisma.harnessProject.findFirst.mockResolvedValueOnce(project({
      device: { userId: "user-1", agentFeatureVersion: MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION },
      modes: {
        dispatch: {
          enabled: true,
          agents: [],
          toolCatalog: [{
            tool: "codex",
            label: "Codex",
            invocation: "subagent",
            role: "generator",
            agentCount: 1,
            modelFamilies: ["codex"],
            capabilities: ["build"]
          }]
        }
      }
    }));
    const response = await POST(issueRequest(v2Desired()));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("invalid_tool_catalog");
    expect(mocks.signHarnessPayload).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("keeps v2 fast/null at the v7 gate but does not require a tool catalog", async () => {
    const noCatalogModes = {
      dispatch: {
        enabled: true,
        integrations: [{
          id: "codex",
          tool: "codex",
          label: "Codex",
          modelFamily: "codex",
          roles: ["planner", "generator", "evaluator"],
          invocations: ["local-cli"],
          capabilities: ["build"],
          localCli: true,
          subagent: false,
          a2aTargetCount: 0,
          sandboxed: true
        }]
      }
    };
    mocks.prisma.harnessProject.findFirst.mockResolvedValueOnce(project({
      device: { userId: "user-1", agentFeatureVersion: MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION - 1 },
      modes: noCatalogModes
    }));
    const oldAgent = await POST(issueRequest(v2FastDesired()));
    expect(oldAgent.status).toBe(409);
    expect((await oldAgent.json()).code).toBe("tool_binding_agent_upgrade_required");

    mocks.prisma.harnessProject.findFirst.mockResolvedValueOnce(project({
      device: { userId: "user-1", agentFeatureVersion: MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION },
      modes: noCatalogModes
    }));
    const response = await POST(issueRequest(v2FastDesired()));
    expect(response.status).toBe(201);
    expect(mocks.signHarnessPayload).toHaveBeenCalledWith(expect.objectContaining({ desired: v2FastDesired() }));
  });

  it("creates no intent row when signing fails", async () => {
    mocks.signHarnessPayload.mockImplementationOnce(() => {
      throw new Error("private material that must not be echoed");
    });
    const response = await POST(issueRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "mode intent signing is unavailable", code: "signing_unavailable" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.tx.harnessModeIntent.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.harnessModeIntent.create).not.toHaveBeenCalled();
  });

  it("signs first, then transactionally supersedes active rows and creates one issued row", async () => {
    const response = await POST(issueRequest());
    expect(response.status).toBe(201);
    expect(mocks.signHarnessPayload).toHaveBeenCalledTimes(1);
    expect(mocks.tx.harnessModeIntent.updateMany).toHaveBeenCalledWith({
      where: {
        harnessProjectId: "project-1",
        userId: "user-1",
        status: { in: ["issued", "relayed", "staged"] }
      },
      data: { status: "superseded" }
    });
    expect(mocks.tx.harnessModeIntent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        harnessProjectId: "project-1",
        signature: "signed",
        status: "issued"
      })
    });
    const signedPayload = mocks.signHarnessPayload.mock.calls[0][0];
    expect(signedPayload.repo_key).toBe("github.com/acme/tokenizer");
    expect(signedPayload.expected_head_sha).toBe(HEAD);
    expect(signedPayload.issued_by).toBe("owner@example.test");
  });

  it("never cancels staged/applied intents", async () => {
    mocks.prisma.harnessProject.findFirst.mockResolvedValueOnce({ id: "project-1" });
    mocks.prisma.harnessModeIntent.findFirst.mockResolvedValueOnce({ id: "row-1", status: "staged" });
    const response = await DELETE(
      new Request("http://localhost/api/harness/mode-intents", {
        method: "DELETE",
        body: JSON.stringify({ projectId: "project-1", intentId: "intent-1" })
      })
    );
    expect(response.status).toBe(409);
    expect(mocks.prisma.harnessModeIntent.updateMany).not.toHaveBeenCalled();
  });
});
