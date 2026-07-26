import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildModeSnapshot, readFramework } from "@/cli/harness-modes";

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
      model_family: "codex", sandbox: { home_dir: "~/x" } },
    { id: "reviewer-kimi", roles: ["evaluator"], transport: "local-cli", adapter: "kimi",
      model_family: "kimi", sandbox: { home_dir: "~/y" } }
  ]
};

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

  it("被指派的角色走 local-cli 即本地异构", () => {
    write(".agents-registry.json", JSON.stringify(REGISTRY));
    write("progress.json", JSON.stringify({
      role_assignments: { generator: "builder-codex", evaluator: "reviewer-claude" }
    }));
    const s = buildModeSnapshot(repo);
    expect(s.execution).toBe("heterogeneous");
    expect(s.dispatch.familyExclusive).toBe(true);
  });
});

describe("独立性与沙箱", () => {
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
