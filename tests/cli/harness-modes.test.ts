import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign as edSign } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildModeSnapshot, readFramework } from "@/cli/harness-modes";
import { canonicalJson } from "@/server/harness-sign";

/**
 * 模式指纹是控制台「看一眼就知道这项目跑在什么模式」的唯一数据来源。
 * 它算错不会削弱机器上的守门（那些校验器独立执行），但会让人**误以为**护栏在位——
 * 所以「同 family」「deny-list 没合入」「local-cli 没配沙箱」这三条必须钉死。
 */

let repo: string;

function write(rel: string, content: string) {
  const p = join(repo, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, content);
  return p;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const REGISTRY = {
  agents: [
    { id: "main-claude", roles: ["generator"], transport: "subagent", model_family: "claude" },
    { id: "reviewer-claude", roles: ["evaluator"], transport: "subagent", model_family: "claude" },
    { id: "builder-codex", roles: ["generator"], transport: "local-cli", adapter: "codex",
      model_family: "codex", capabilities: ["build", "fix"], sandbox: { home_dir: "~/x" } },
    { id: "reviewer-kimi", roles: ["evaluator"], transport: "local-cli", adapter: "kimi",
      model_family: "kimi", sandbox: { home_dir: "~/y" } }
  ]
};

const CATALOG_REGISTRY = {
  version: "dispatch/1",
  agents: [
    { id: "planner-claude", roles: ["planner"], transport: "subagent", agent_type: "planner-proposal", model_family: "claude", capabilities: ["plan"] },
    { id: "builder-future", roles: ["generator"], transport: "local-cli", adapter: "future-cli", model_family: "codex", capabilities: ["build"], sandbox: { home_dir: "~/future" }, constraints: { l2: false, write_src: true, push: false } },
    { id: "reviewer-kimi", roles: ["evaluator"], transport: "local-cli", adapter: "kimi", model_family: "kimi", capabilities: ["verify"], sandbox: { home_dir: "~/kimi" } }
  ]
};

const INTEGRATION_REGISTRY = {
  version: "tool-integrations/1",
  integrations: [
    {
      id: "future-local",
      tool: "future-cli",
      label: "Future CLI",
      model_family: "codex",
      priority: 100,
      capabilities: ["build", "verify"],
      local_cli: {
        adapter: "future-cli",
        sandbox: { home_dir: "~/.harness-sandbox/future" },
        timeout_s: 1800
      }
    },
    {
      id: "kimi-local",
      tool: "kimi",
      label: "Kimi CLI",
      model_family: "kimi",
      priority: 100,
      capabilities: ["plan", "verify"],
      local_cli: {
        adapter: "kimi",
        sandbox: { home_dir: "~/.harness-sandbox/kimi" },
        timeout_s: 1800
      }
    }
  ],
  a2a_targets: [
    {
      id: "kimi-remote",
      integration_id: "kimi-local",
      endpoint: "https://example.invalid/kimi",
      remote_runner_id: "kimi-runner-1",
      priority: 100,
      capabilities: ["verify"]
    }
  ]
};

function installToolCatalogFixture(registry: Record<string, unknown> = CATALOG_REGISTRY) {
  write(".agents-registry.json", JSON.stringify(registry));
  write(".claude/dispatch/transports/adapters/future-cli.json", JSON.stringify({
    name: "future-cli", tool: "future-cli", display_name: "Future CLI", model_family: "codex",
    argv: ["future-cli"], envelope_delivery: "env", _verified: true
  }));
  write(".claude/dispatch/transports/adapters/kimi.json", JSON.stringify({
    name: "kimi", tool: "kimi", display_name: "Kimi", model_family: "kimi",
    argv: ["kimi"], envelope_delivery: "stdin", _verified: true
  }));
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "modes-"));
  write("progress.json", JSON.stringify({ status: "building", autonomy: { status: null } }));
  write(".claude/settings.json", JSON.stringify({
    hooks: {
      SessionStart: [{ hooks: [{ command: "bash .claude/hooks/session-start.sh" }] }],
      PostToolUse: [{ hooks: [
        { command: "bash .claude/hooks/validate-state-json.sh" },
        { command: "bash .claude/dispatch/validate-dispatch.sh hook" },
        { command: "bash .claude/console/validate-pending-gate.sh hook" }
      ] }]
    }
  }));
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("执行形态", () => {
  it("没有注册表就是快车道（dispatch 默认 inert）", () => {
    const s = buildModeSnapshot(repo);
    expect(s.execution).toBe("fast");
    expect(s.dispatch.enabled).toBe(false);
  });

  it("被指派的角色走 local-cli 即异构执行", () => {
    write(".agents-registry.json", JSON.stringify(REGISTRY));
    write("progress.json", JSON.stringify({
      role_assignments: { generator: "builder-codex", evaluator: "reviewer-claude" }
    }));
    const s = buildModeSnapshot(repo);
    expect(s.execution).toBe("heterogeneous");
    expect(s.dispatch.familyExclusive).toBe(true);
  });

  it("A2A evaluator 与 local-cli generator 并存时，慢车道优先", () => {
    const registry = structuredClone(REGISTRY);
    registry.agents.push({
      id: "reviewer-kimi-a2a",
      roles: ["evaluator"],
      transport: "a2a",
      model_family: "kimi"
    });
    write(".agents-registry.json", JSON.stringify(registry));
    write("progress.json", JSON.stringify({
      role_assignments: { generator: "builder-codex", evaluator: "reviewer-kimi-a2a" }
    }));

    expect(buildModeSnapshot(repo).execution).toBe("slow");
  });

  it("uses a persisted v2 resolution as the tool-centric current-mode audit", () => {
    const registry = structuredClone(REGISTRY);
    registry.agents.push(
      { id: "planner-claude", roles: ["planner"], transport: "subagent", model_family: "claude" },
      { id: "reviewer-kimi-a2a", roles: ["evaluator"], transport: "a2a", model_family: "kimi" }
    );
    write(".agents-registry.json", JSON.stringify(registry));
    write("progress.json", JSON.stringify({
      role_assignments: {
        planner: "planner-claude",
        generator: "builder-codex",
        evaluator: "reviewer-kimi-a2a"
      },
      mode_intent: {
        intent_id: "intent-1",
        resolution: {
          planner: { agent_id: "planner-claude", tool: "claude-code", invocation: "subagent", model_family: "claude", priority: 100 },
          generator: { agent_id: "builder-codex", tool: "codex", invocation: "local-cli", model_family: "codex", priority: 100 },
          evaluator: { agent_id: "reviewer-kimi-a2a", tool: "kimi", invocation: "a2a", model_family: "kimi", priority: 100 }
        }
      }
    }));

    const snapshot = buildModeSnapshot(repo);
    expect(snapshot.execution).toBe("slow");
    expect(snapshot.current).toEqual({
      profile: "slow",
      roleBindings: {
        planner: { tool: "claude-code", invocation: "subagent", modelFamily: "claude" },
        generator: { tool: "codex", invocation: "local-cli", modelFamily: "codex" },
        evaluator: { tool: "kimi", invocation: "a2a", modelFamily: "kimi" }
      }
    });
    expect(JSON.stringify(snapshot.current)).not.toContain("builder-codex");
  });

  it("reports a same-session subagent-only v2 resolution as heterogeneous", () => {
    const registry = structuredClone(REGISTRY);
    registry.agents = [
      { id: "planner-codex", roles: ["planner"], transport: "subagent", model_family: "codex" },
      { id: "builder-codex", roles: ["generator"], transport: "subagent", model_family: "codex" },
      { id: "reviewer-kimi", roles: ["evaluator"], transport: "subagent", model_family: "kimi" }
    ];
    write(".agents-registry.json", JSON.stringify(registry));
    write("progress.json", JSON.stringify({
      role_assignments: {
        planner: "planner-codex",
        generator: "builder-codex",
        evaluator: "reviewer-kimi"
      },
      mode_intent: {
        intent_id: "intent-bridge",
        resolution: {
          planner: { agent_id: "planner-codex", tool: "codex", invocation: "subagent", model_family: "codex", priority: 100 },
          generator: { agent_id: "builder-codex", tool: "codex", invocation: "subagent", model_family: "codex", priority: 100 },
          evaluator: { agent_id: "reviewer-kimi", tool: "kimi", invocation: "subagent", model_family: "kimi", priority: 100 }
        }
      }
    }));

    const snapshot = buildModeSnapshot(repo);
    expect(snapshot.execution).toBe("heterogeneous");
    expect(snapshot.current?.profile).toBe("heterogeneous");
    expect(snapshot.dispatch.familyExclusive).toBe(true);
  });

  it("reports tool integrations and treats a null Planner resolution as the Coordinator", () => {
    installToolCatalogFixture(INTEGRATION_REGISTRY);
    write("progress.json", JSON.stringify({
      role_assignments: {
        planner: null,
        generator: "future-runner",
        evaluator: "kimi-remote-runner"
      },
      mode_intent: {
        intent_id: "intent-coordinator",
        resolution: {
          planner: null,
          generator: { agent_id: "future-runner", tool: "future-cli", invocation: "local-cli", model_family: "codex", priority: 100 },
          evaluator: { agent_id: "kimi-remote-runner", tool: "kimi", invocation: "a2a", model_family: "kimi", priority: 100 }
        }
      }
    }));

    const snapshot = buildModeSnapshot(repo);
    expect(snapshot.dispatch.enabled).toBe(true);
    expect(snapshot.dispatch.assignments.planner).toBeNull();
    expect(snapshot.dispatch.agents).toEqual([]);
    expect(snapshot.dispatch.integrations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "future-local", invocations: ["local-cli"] }),
      expect.objectContaining({ id: "kimi-local", invocations: ["local-cli", "a2a"], a2aTargetCount: 1 })
    ]));
    expect(snapshot.current).toEqual({
      profile: "slow",
      roleBindings: {
        planner: null,
        generator: { tool: "future-cli", invocation: "local-cli", modelFamily: "codex" },
        evaluator: { tool: "kimi", invocation: "a2a", modelFamily: "kimi" }
      }
    });
    expect(snapshot.dispatch.familyExclusive).toBe(true);
    expect(JSON.stringify(snapshot.dispatch.integrations)).not.toContain("kimi-remote-runner");
  });
});

describe("独立性与沙箱", () => {
  it("reports framework-owned catalog choices without deriving tool ids from agent cards", () => {
    installToolCatalogFixture();

    const snapshot = buildModeSnapshot(repo);
    expect(snapshot.dispatch.toolCatalog).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: "future-cli", label: "Future CLI", role: "generator" })
    ]));
    expect(snapshot.dispatch.toolCatalog).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ invocation: "subagent" })
    ]));
    expect(JSON.stringify(snapshot.dispatch.toolCatalog)).not.toContain("agentId");
    expect(snapshot.dispatch.issues).not.toContain("dispatch tool catalog is unavailable");
  });

  it("withholds the catalog when the data-only registry validation fails", () => {
    const invalid = structuredClone(CATALOG_REGISTRY);
    invalid.agents[0].agent_type = "generator-restricted";
    installToolCatalogFixture(invalid);

    const snapshot = buildModeSnapshot(repo);
    expect(snapshot.dispatch.toolCatalog).toEqual([]);
    expect(snapshot.dispatch.issues).toContain("dispatch tool catalog is unavailable");
  });

  it("surfaces a canonical registry validation failure while keeping dispatch inert", () => {
    const invalid = structuredClone(INTEGRATION_REGISTRY);
    invalid.integrations[0].local_cli.adapter = "missing-adapter";
    installToolCatalogFixture(invalid);

    const snapshot = buildModeSnapshot(repo);
    expect(snapshot.dispatch.enabled).toBe(false);
    expect(snapshot.dispatch.toolCatalog).toEqual([]);
    expect(snapshot.dispatch.issues).toContain("dispatch tool catalog is unavailable");
  });

  it("上报 registry capabilities 与有界待生效 defaults 摘要", () => {
    const now = Date.parse("2026-07-27T12:00:00.000Z");
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const payload = {
      intent_id: "intent-1",
      repo_key: "github.com/acme/repo",
      expected_head_sha: "a".repeat(40),
      desired: {
        execution: {
          profile: "heterogeneous",
          role_assignments: { generator: "builder-codex", evaluator: "reviewer-kimi" }
        },
        autonomy: { enabled: false }
      },
      issued_by: "owner@example.test",
      issued_at: "2026-07-27T11:00:00.000Z",
      intent_expires_at: "2026-07-28T12:00:00.000Z"
    } as const;
    const intent = {
      ...payload,
      sig: edSign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64")
    };
    write(".agents-registry.json", JSON.stringify(REGISTRY));
    execFileSync("git", ["init", "-q", repo]);
    execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/repo.git"], { cwd: repo });
    write(".claude/console/console.pub", publicKey.export({ type: "spki", format: "pem" }).toString());
    write("harness.json", JSON.stringify({
      framework: {},
      project: { name: "fixture", mode_defaults: { intent, staged_at: "2026-07-27T11:05:00.000Z" } }
    }));

    const snapshot = buildModeSnapshot(repo, now);
    expect(snapshot.dispatch.agents.find((agent) => agent.id === "builder-codex")?.capabilities).toEqual(["build", "fix"]);
    expect(snapshot.pendingDefaults).toMatchObject({
      intentId: "intent-1",
      execution: {
        profile: "heterogeneous",
        roleAssignments: { generator: "builder-codex", evaluator: "reviewer-kimi" }
      },
      autonomy: { enabled: false, expiresAt: null }
    });
  });

  it("🔴 generator 与 evaluator 同 family 必须报出来", () => {
    write(".agents-registry.json", JSON.stringify(REGISTRY));
    write("progress.json", JSON.stringify({
      role_assignments: { generator: "main-claude", evaluator: "reviewer-claude" }
    }));
    const s = buildModeSnapshot(repo);
    expect(s.dispatch.familyExclusive).toBe(false);
    expect(s.dispatch.issues.join()).toContain("claude family");
  });

  it("🔴 local-cli 没配 sandbox 要报出来 —— env 白名单会被登录 shell 还原", () => {
    write(".agents-registry.json", JSON.stringify({
      agents: [{ id: "bare-codex", roles: ["evaluator"], transport: "local-cli", model_family: "codex" }]
    }));
    const s = buildModeSnapshot(repo);
    expect(s.dispatch.issues.join()).toContain("没配 sandbox");
  });

  it("role_assignments 指向注册表里没有的 id 要报出来", () => {
    write(".agents-registry.json", JSON.stringify(REGISTRY));
    write("progress.json", JSON.stringify({ role_assignments: { evaluator: "ghost-agent" } }));
    expect(buildModeSnapshot(repo).dispatch.issues.join()).toContain("ghost-agent");
  });
});

describe("闸门校验模式", () => {
  it("有 console.pub 即验签模式", () => {
    write(".claude/console/console.pub", "-----BEGIN PUBLIC KEY-----\n");
    const s = buildModeSnapshot(repo);
    expect(s.gate.pubInstalled).toBe(true);
    expect(s.gate.guardMode).toBe("signature");
  });

  it("没有则回退比对 HEAD", () => {
    expect(buildModeSnapshot(repo).gate.guardMode).toBe("head-compare");
  });
});

describe("自主模式", () => {
  it("policy 过期即判失效（轻量判据，权威仍是校验脚本）", () => {
    write("autonomy-policy.json", JSON.stringify({ authorized_by: "user", expires_at: "2020-01-01T00:00:00Z" }));
    const s = buildModeSnapshot(repo);
    expect(s.autonomy.enabled).toBe(true);
    expect(s.autonomy.policyValid).toBe(false);
  });

  it("authorized_by 不是 user 即判失效", () => {
    write("autonomy-policy.json", JSON.stringify({ authorized_by: "agent" }));
    expect(buildModeSnapshot(repo).autonomy.policyValid).toBe(false);
  });
});

describe("机件在位", () => {
  it("🔴 deny-list 未合入 settings.json 要报出来 —— 否则护栏只是纸面的", () => {
    write(".claude/autonomous/settings.autodrive.json", JSON.stringify({
      permissions: { deny: ["Bash(vercel deploy:*)", "Write(autonomy-policy.json)"] }
    }));
    expect(buildModeSnapshot(repo).machinery.denyListMerged).toBe(false);
  });

  it("全部合入则为 true", () => {
    write(".claude/autonomous/settings.autodrive.json", JSON.stringify({
      permissions: { deny: ["Bash(vercel deploy:*)"] }
    }));
    write(".claude/settings.json", JSON.stringify({
      hooks: {}, permissions: { deny: ["Bash(vercel deploy:*)", "Bash(other:*)"] }
    }));
    expect(buildModeSnapshot(repo).machinery.denyListMerged).toBe(true);
  });

  it("缺守门 hook 要列出来", () => {
    write(".claude/settings.json", JSON.stringify({ hooks: {} }));
    const m = buildModeSnapshot(repo).machinery;
    expect(m.missing).toContain("pending-gate");
    expect(m.hooks).toHaveLength(0);
  });
});

describe("框架账本与漂移", () => {
  it("无 harness.lock 时返回 null（v1.4 之前的项目）", () => {
    expect(buildModeSnapshot(repo).framework).toBeNull();
  });

  it("区分「又改过」与「已登记的本地定制」—— 两者含义不同", () => {
    write("a.md", "original");
    write("b.md", "customized-and-recorded");
    write("harness.lock", JSON.stringify({
      framework: { version: "1.4.0", commit: "abc1234" },
      managed: {
        "a.md": { sha256: sha("original"), upstream: sha("original") },
        "b.md": { sha256: sha("customized-and-recorded"), upstream: sha("upstream-original") },
        "gone.md": { sha256: sha("x"), upstream: sha("x") }
      }
    }));
    const f = readFramework(repo, Date.now())!;
    expect(f.version).toBe("1.4.0");
    expect(f.drift).toEqual({ ok: 1, modified: 0, missing: 1, customized: 1 });

    // 改动 a.md 后必须立刻反映（lock 未变，但缓存要按内容失效——这里用新时间戳绕过 TTL）
    write("a.md", "locally edited");
    expect(readFramework(repo, Date.now() + 11 * 60 * 1000)!.drift.modified).toBe(1);
  });
});
