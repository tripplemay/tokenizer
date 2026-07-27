import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("@/cli/fetch", () => ({ agentFetch: (...args: unknown[]) => fetchMock(...args) }));
vi.mock("../../src/cli/fetch", () => ({ agentFetch: (...args: unknown[]) => fetchMock(...args) }));

const credentialsMock = { deviceToken: "device-token" };
vi.mock("@/cli/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/cli/config")>();
  return { ...actual, readCredentials: () => credentialsMock };
});

import {
  applyHarnessDecisions,
  buildReport,
  discoverHarnessRepos,
  reportHarnessState,
  runHarnessSync
} from "@/cli/harness";
import { canonicalJson } from "@/server/harness-sign";
import { sign as edSign, createPrivateKey } from "node:crypto";

let root: string;
let repo: string;
let privPem: string;

function git(args: string[], cwd = repo) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeGate(id = "BL-042-verifying-done-w7") {
  return {
    id,
    kind: "phase_advance",
    raised_at: "2026-07-25T13:00:00Z",
    raised_by: "autodriver",
    batch: "BL-042",
    from_status: "verifying",
    to_status: "done",
    detail: "等人类批准",
    evidence: [],
    decision: null as unknown
  };
}

function writeProgress(gate: unknown) {
  writeFileSync(
    join(repo, "progress.json"),
    `${JSON.stringify({ status: "verifying", current_sprint: "BL-042", fix_rounds: 1, pending_gate: gate }, null, 2)}\n`
  );
}

function signedDecision(gateId: string, key = privPem) {
  const decision: Record<string, unknown> = {
    gate_id: gateId, action: "approve", by: "yixing@example.com",
    at: "2026-07-25T14:00:00Z", scope: { once: true }
  };
  decision.sig = edSign(null, Buffer.from(canonicalJson(decision), "utf8"), createPrivateKey(key)).toString("base64");
  return decision;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "harness-cli-"));
  repo = join(root, "myproject");
  mkdirSync(join(repo, ".claude", "console"), { recursive: true });
  git(["init", "-q", repo], root);
  git(["config", "user.email", "t@t"]);
  git(["config", "user.name", "t"]);
  git(["remote", "add", "origin", "https://github.com/acme/myproject.git"]);

  const keyDir = mkdtempSync(join(tmpdir(), "harness-key-"));
  const privPath = join(keyDir, "console.key");
  execFileSync("openssl", ["genpkey", "-algorithm", "ed25519", "-out", privPath]);
  execFileSync("openssl", ["pkey", "-in", privPath, "-pubout", "-out", join(repo, ".claude/console/console.pub")]);
  privPem = readFileSync(privPath, "utf8");

  writeFileSync(join(repo, "harness-rules.md"), "# harness\n");
  writeFileSync(join(repo, "harness.json"), `${JSON.stringify({ framework: {}, project: { name: "myproject" } }, null, 2)}\n`);
  writeFileSync(
    join(repo, "features.json"),
    JSON.stringify({ features: [
      { id: "F001", status: "completed", executor: "generator" },
      { id: "F002", status: "completed", executor: "generator" },
      { id: "F003", status: "pending", executor: "generator" }
    ] })
  );
  writeProgress(makeGate());
  git(["add", "-A"]);
  git(["commit", "-qm", "init"]);
  fetchMock.mockReset();
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const config = () => ({ serverUrl: "https://example.test", projectRoots: [root], sources: {} }) as never;

function mockDecisions(decisions: unknown[]) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ decisions }) });
}

/** 分别桩住两个端点 —— 上报与中继必须能各自失败，才测得出「一步失败不拖住另一步」。 */
function mockRoutes(options: { reportOk?: boolean; decisions?: unknown[] }) {
  fetchMock.mockImplementation(async (url: unknown, init?: { method?: string }) => {
    if (String(url).includes("/api/harness/report")) {
      return options.reportOk === false
        ? { ok: false, status: 500, text: async () => "server exploded" }
        : { ok: true, json: async () => ({ ok: true, harnessProjectId: "project-1" }) };
    }
    if (String(url).includes("/api/harness/mode-intents/relay")) {
      return init?.method === "POST"
        ? { ok: true, status: 200 }
        : { ok: true, text: async () => JSON.stringify({ intents: [] }) };
    }
    return { ok: true, json: async () => ({ decisions: options.decisions ?? [] }) };
  });
}

function signedModeIntent(expectedHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim()) {
  const payload = {
    intent_id: "intent-mode-1",
    repo_key: "github.com/acme/myproject",
    expected_head_sha: expectedHead,
    desired: { execution: { profile: "fast", role_assignments: null }, autonomy: { enabled: false } },
    issued_by: "owner@example.test",
    issued_at: "2026-07-27T11:00:00.000Z",
    intent_expires_at: "2099-07-28T12:00:00.000Z"
  };
  return {
    projectId: "project-1",
    repoKey: "github.com/acme/myproject",
    intent: {
      ...payload,
      sig: edSign(null, Buffer.from(canonicalJson(payload), "utf8"), createPrivateKey(privPem)).toString("base64")
    }
  };
}

/** 在同一个 projectRoots 下再造一个 harness 项目（无待批闸门）。 */
function makeSecondRepo(name: string) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  git(["init", "-q", dir], root);
  git(["config", "user.email", "t@t"], dir);
  git(["config", "user.name", "t"], dir);
  writeFileSync(join(dir, "harness-rules.md"), "# harness\n");
  writeFileSync(join(dir, "progress.json"), `${JSON.stringify({ status: "building", pending_gate: null }, null, 2)}\n`);
  git(["add", "-A"], dir);
  git(["commit", "-qm", "init"], dir);
  return dir;
}

describe("discoverHarnessRepos", () => {
  it("同时有 progress.json 与 harness-rules.md 才算 harness 项目", () => {
    expect(discoverHarnessRepos(config())).toHaveLength(1);
    rmSync(join(repo, "harness-rules.md"));
    expect(discoverHarnessRepos(config())).toHaveLength(0);
  });
});

describe("buildReport", () => {
  it("从 features.json 统计完成度，并带上待批闸门", () => {
    const body = buildReport(discoverHarnessRepos(config())[0])!;
    expect(body.state.completed).toBe(2);
    expect(body.state.total).toBe(3);
    expect(body.state.fixRounds).toBe(1);
    expect(body.state.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect((body.gate as { id: string }).id).toBe("BL-042-verifying-done-w7");
  });

  it("已有决策的闸门不再上报 —— 服务端记录为准，防本机旧副本覆盖", () => {
    writeProgress({ ...makeGate(), decision: { action: "approve" } });
    expect(buildReport(discoverHarnessRepos(config())[0])!.gate).toBeNull();
  });
});

describe("mode intent report ACK", () => {
  it("reports progress.mode_intent as applied and sends the identical applied ACK", async () => {
    writeFileSync(
      join(repo, "progress.json"),
      `${JSON.stringify({
        status: "building",
        current_sprint: "BL-NEXT",
        pending_gate: null,
        mode_intent: {
          intent_id: "intent-mode-1",
          applied_batch: "BL-NEXT",
          applied_at: "2026-07-27T12:00:00.000Z"
        }
      }, null, 2)}\n`
    );
    git(["commit", "-qam", "applied mode"]);
    const posted: unknown[] = [];
    fetchMock.mockImplementation(async (url: unknown, init?: { method?: string; body?: string }) => {
      if (String(url).includes("/api/harness/report")) {
        return { ok: true, json: async () => ({ harnessProjectId: "project-1" }) };
      }
      if (String(url).includes("/api/harness/mode-intents/relay") && init?.method === "POST") {
        posted.push(JSON.parse(init.body ?? "null"));
        return { ok: false, status: 503 };
      }
      throw new Error("unexpected endpoint");
    });

    const result = await reportHarnessState(config());
    expect(result.reported).toBe(1);
    expect(result.skippedReports).toEqual([]);
    expect(result.skippedAppliedAcks).toHaveLength(1);
    expect(posted).toEqual([{
      projectId: "project-1",
      intentId: "intent-mode-1",
      status: "applied",
      appliedAt: "2026-07-27T12:00:00.000Z",
      appliedBatch: "BL-NEXT"
    }]);
  });
});

describe("applyHarnessDecisions", () => {
  it("签名有效时写入并提交", async () => {
    mockDecisions([{ repoKey: discoverHarnessRepos(config())[0].repoKey, gate_id: "BL-042-verifying-done-w7",
      decision: signedDecision("BL-042-verifying-done-w7") }]);
    const result = await applyHarnessDecisions(config());
    expect(result.applied).toBe(1);
    const written = JSON.parse(readFileSync(join(repo, "progress.json"), "utf8"));
    expect(written.pending_gate.decision.by).toBe("yixing@example.com");
    expect(execFileSync("git", ["log", "-1", "--format=%s"], { cwd: repo, encoding: "utf8" }))
      .toContain("chore(gate): relay");
  });

  it("🔴 签名无效一律不写 —— 否则任何能调这个 API 的东西都能伪造批准", async () => {
    const forged = signedDecision("BL-042-verifying-done-w7");
    forged.by = "attacker";            // 载荷改了，签名没跟着改
    mockDecisions([{ repoKey: discoverHarnessRepos(config())[0].repoKey, gate_id: "BL-042-verifying-done-w7", decision: forged }]);
    const result = await applyHarnessDecisions(config());
    expect(result.applied).toBe(0);
    expect(result.skipped[0]).toContain("验签失败");
    expect(JSON.parse(readFileSync(join(repo, "progress.json"), "utf8")).pending_gate.decision).toBeNull();
  });

  it("仓库缺 console.pub 时拒绝写入（无法验证来源，宁可卡住）", async () => {
    rmSync(join(repo, ".claude/console/console.pub"));
    mockDecisions([{ repoKey: discoverHarnessRepos(config())[0].repoKey, gate_id: "BL-042-verifying-done-w7",
      decision: signedDecision("BL-042-verifying-done-w7") }]);
    expect((await applyHarnessDecisions(config())).applied).toBe(0);
  });

  it("陈旧批准不得解锁另一个闸门（gate id 不匹配即跳过）", async () => {
    writeProgress(makeGate("BL-043-another-gate-w1"));
    git(["commit", "-qam", "new gate"]);
    mockDecisions([{ repoKey: discoverHarnessRepos(config())[0].repoKey, gate_id: "BL-042-verifying-done-w7",
      decision: signedDecision("BL-042-verifying-done-w7") }]);
    const result = await applyHarnessDecisions(config());
    expect(result.applied).toBe(0);
    expect(result.skipped[0]).toContain("不匹配");
  });

  it("progress.json 有未提交改动时本轮不写，避免与状态机打架", async () => {
    writeProgress({ ...makeGate(), detail: "机器正在写" });   // 脏工作区
    mockDecisions([{ repoKey: discoverHarnessRepos(config())[0].repoKey, gate_id: "BL-042-verifying-done-w7",
      decision: signedDecision("BL-042-verifying-done-w7") }]);
    const result = await applyHarnessDecisions(config());
    expect(result.applied).toBe(0);
    expect(result.skipped[0]).toContain("未提交改动");
  });

  it("某个项目上报失败不中断其余项目", async () => {
    makeSecondRepo("other");
    let calls = 0;
    fetchMock.mockImplementation(async (url: unknown) => {
      if (!String(url).includes("/api/harness/report")) return { ok: true, json: async () => ({ decisions: [] }) };
      calls += 1;
      return calls === 1
        ? { ok: false, status: 500, text: async () => "server exploded" }
        : { ok: true, json: async () => ({ ok: true }) };
    });
    const result = await runHarnessSync(config());
    expect(calls).toBe(2);                       // 第一个失败后仍然试了第二个
    expect(result.reported).toBe(1);
    expect(result.skippedReports).toHaveLength(1);
  });

  it("🔴 上报整体失败也不拖住闸门中继 —— 人在网页上批了，机器必须还能拿到", async () => {
    mockRoutes({
      reportOk: false,
      decisions: [{ repoKey: discoverHarnessRepos(config())[0].repoKey, gate_id: "BL-042-verifying-done-w7",
        decision: signedDecision("BL-042-verifying-done-w7") }]
    });
    const result = await runHarnessSync(config());
    expect(result.reported).toBe(0);
    expect(result.skippedReports[0]).toContain("上报失败");
    expect(result.applied).toBe(1);
    expect(JSON.parse(readFileSync(join(repo, "progress.json"), "utf8")).pending_gate.decision.action).toBe("approve");
  });

  it("report、mode-intent 与 gate relay 三步各自失败隔离，且 mode staging 先于 gate commit", async () => {
    const mode = signedModeIntent();
    const decision = signedDecision("BL-042-verifying-done-w7");
    const calls: string[] = [];
    fetchMock.mockImplementation(async (url: unknown, init?: { method?: string; body?: string }) => {
      const path = String(url);
      if (path.includes("/api/harness/report")) {
        calls.push("report");
        throw new Error("report unavailable");
      }
      if (path.includes("/api/harness/mode-intents/relay")) {
        if (init?.method === "POST") {
          calls.push(`mode-ack:${JSON.parse(init.body ?? "{}").status}`);
          return { ok: true, status: 200 };
        }
        calls.push("mode-get");
        return { ok: true, text: async () => JSON.stringify({ intents: [mode] }) };
      }
      calls.push("gate-get");
      return {
        ok: true,
        json: async () => ({
          decisions: [{
            repoKey: "github.com/acme/myproject",
            gate_id: "BL-042-verifying-done-w7",
            decision
          }]
        })
      };
    });

    const result = await runHarnessSync(config());
    expect(result.reported).toBe(0);
    expect(result.stagedIntents).toBe(1);
    expect(result.applied).toBe(1);
    expect(calls).toEqual(["report", "mode-get", "mode-ack:staged", "gate-get"]);
    expect(JSON.parse(readFileSync(join(repo, "harness.json"), "utf8")).project.mode_defaults.intent.intent_id)
      .toBe("intent-mode-1");
    expect(JSON.parse(readFileSync(join(repo, "progress.json"), "utf8")).pending_gate.decision.action)
      .toBe("approve");
  });

  it.each(["mode", "gate"] as const)("%s relay 失败不阻塞另外两步", async (failedStep) => {
    const mode = signedModeIntent();
    const decision = signedDecision("BL-042-verifying-done-w7");
    fetchMock.mockImplementation(async (url: unknown, init?: { method?: string }) => {
      const path = String(url);
      if (path.includes("/api/harness/report")) {
        return { ok: true, json: async () => ({ harnessProjectId: "project-1" }) };
      }
      if (path.includes("/api/harness/mode-intents/relay")) {
        if (init?.method === "POST") return { ok: true, status: 200 };
        if (failedStep === "mode") throw new Error("mode relay unavailable");
        return { ok: true, text: async () => JSON.stringify({ intents: [mode] }) };
      }
      if (failedStep === "gate") throw new Error("gate relay unavailable");
      return {
        ok: true,
        json: async () => ({
          decisions: [{
            repoKey: "github.com/acme/myproject",
            gate_id: "BL-042-verifying-done-w7",
            decision
          }]
        })
      };
    });

    const result = await runHarnessSync(config());
    expect(result.reported).toBe(1);
    expect(result.stagedIntents).toBe(failedStep === "mode" ? 0 : 1);
    expect(result.applied).toBe(failedStep === "gate" ? 0 : 1);
  });

  it("本机闸门已有决策时不覆盖", async () => {
    writeProgress({ ...makeGate(), decision: { gate_id: "BL-042-verifying-done-w7", action: "reject", by: "someone", at: "t" } });
    git(["commit", "-qam", "already decided"]);
    mockDecisions([{ repoKey: discoverHarnessRepos(config())[0].repoKey, gate_id: "BL-042-verifying-done-w7",
      decision: signedDecision("BL-042-verifying-done-w7") }]);
    const result = await applyHarnessDecisions(config());
    expect(result.applied).toBe(0);
    expect(JSON.parse(readFileSync(join(repo, "progress.json"), "utf8")).pending_gate.decision.action).toBe("reject");
  });
});
