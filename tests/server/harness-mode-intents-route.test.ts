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

const HEAD = "0123456789abcdef0123456789abcdef01234567";

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
        ]
      }
    },
    device: { userId: "user-1", agentFeatureVersion: 4 },
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
    ["old agent", project({ device: { userId: "user-1", agentFeatureVersion: 3 } }), "agent_upgrade_required"],
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
