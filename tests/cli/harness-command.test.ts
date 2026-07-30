import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runHarnessCommand, type HarnessCommandDeps } from "@/cli/harness-command";
import type { HarnessSyncResult } from "@/cli/harness";
import type { HarnessSyncSnapshot } from "@/shared/harness-health";

const config = {
  serverUrl: "https://example.test",
  projectRoots: ["/private/work"],
  sources: { claude: true, codex: true, opencode: true, aider: true, kimicode: true }
};

const repo = { path: "/private/work/tokenizer", name: "tokenizer", repoKey: "github.com/acme/tokenizer" };
const tempHomes: string[] = [];

afterEach(() => {
  for (const home of tempHomes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function snapshot(): HarnessSyncSnapshot {
  return {
    attemptedAt: "2026-07-30T12:00:00.000Z",
    status: "degraded",
    reported: 1,
    failed: 1,
    relayed: 0,
    modeIntents: 0,
    issues: [{ operation: "report", project: "tokenizer", code: "http_400", retryable: false }]
  };
}

function result(): HarnessSyncResult {
  const health = snapshot();
  return {
    reported: 1,
    failed: 1,
    skippedReports: ["response body Bearer secret at /private/work/tokenizer?token=x"],
    skippedAppliedAcks: [],
    applied: 0,
    skipped: [],
    stagedIntents: 0,
    skippedModeIntents: [],
    issues: health.issues,
    snapshot: health,
    issueDetailsChanged: true,
    recovered: false
  };
}

function deps(overrides: Partial<HarnessCommandDeps> = {}) {
  const base = {
    readConfig: vi.fn(() => config),
    discoverHarnessRepos: vi.fn(() => [repo]),
    formatHarnessModeLine: vi.fn(() => "mode"),
    runHarnessSync: vi.fn(async () => result()),
    readHarnessSyncSnapshot: vi.fn(() => snapshot()),
    write: vi.fn(),
  };
  return { ...base, ...overrides } as typeof base;
}

describe("harness CLI output contracts", () => {
  it("--status reads only local state and emits the latest snapshot", async () => {
    const d = deps({ readConfig: vi.fn(() => { throw new Error("must not read config"); }) });
    await runHarnessCommand({ status: true }, d);

    expect(d.readHarnessSyncSnapshot).toHaveBeenCalledOnce();
    expect(d.readConfig).not.toHaveBeenCalled();
    expect(d.runHarnessSync).not.toHaveBeenCalled();
    expect(JSON.parse(d.write.mock.calls[0][0])).toEqual(snapshot());
  });

  it("wires Commander options without treating the Command object as injected dependencies", () => {
    const home = mkdtempSync(join(tmpdir(), "tokenizer-harness-command-"));
    tempHomes.push(home);
    const cli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    const env = { ...process.env, HOME: home };
    const run = (...args: string[]) => spawnSync(process.execPath, [cli, "src/cli/index.ts", ...args], {
      cwd: process.cwd(),
      env,
      encoding: "utf8"
    });

    expect(run("init").status).toBe(0);
    const synced = run("harness", "--json");
    expect(synced.status, synced.stderr).toBe(0);
    expect(synced.stderr).toBe("");
    const snapshot = JSON.parse(synced.stdout.trim());
    expect(snapshot.status).toBe("failed");

    const local = run("harness", "--status");
    expect(local.status, local.stderr).toBe(0);
    expect(local.stderr).toBe("");
    expect(JSON.parse(local.stdout.trim())).toEqual(snapshot);
  });

  it("--json runs one sync and writes one parseable object without list or raw failure text", async () => {
    const d = deps();
    await runHarnessCommand({ json: true }, d);

    expect(d.runHarnessSync).toHaveBeenCalledOnce();
    expect(d.write).toHaveBeenCalledOnce();
    const stdout = d.write.mock.calls[0][0];
    expect(JSON.parse(stdout)).toEqual(snapshot());
    expect(stdout).not.toContain("/private/work");
    expect(stdout).not.toContain("Bearer secret");
    expect(stdout).not.toContain(repo.repoKey);
  });

  it("keeps default human output and appends only normalized issue fields", async () => {
    const d = deps();
    await runHarnessCommand({}, d);

    expect(d.write.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining([
      `${repo.name}  ${repo.repoKey}  ${repo.path}`,
      "Reported: 1  Failed: 1  Relayed: 0  Mode intents: 0",
      "  issue report project=tokenizer code=http_400 retryable=false"
    ]));
  });
});
