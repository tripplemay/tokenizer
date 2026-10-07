import { execFile, execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

type Fixture = { root: string; home: string; label: string; plist: string; cleanupRecord: string };

const fixtures: Fixture[] = [];
const servers: Server[] = [];

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function commitFixture(repo: string, revision: string): string {
  writeFileSync(join(repo, "revision"), `${revision}\n`);
  git(repo, "add", ".");
  git(repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", revision);
  return git(repo, "rev-parse", "HEAD");
}

function launchdJob(label: string): string | null {
  const result = execFileSync("launchctl", ["print", `gui/${process.getuid!()}/${label}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  return result;
}

function launchdJobIfPresent(label: string): string | null {
  try {
    return launchdJob(label);
  } catch {
    return null;
  }
}

function scopedAgentProcesses(root: string): string[] {
  return execFileSync("ps", ["-axww", "-o", "pid=", "-o", "command="], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter((line) => line.includes(root) && /(^|\s)agent(\s|$)/.test(line));
}

async function waitFor<T>(read: () => T | null | false, description: string, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function stopFixture(fixture: Fixture): Promise<void> {
  try {
    execFileSync("launchctl", ["unload", fixture.plist], { stdio: "ignore" });
  } catch {
    // The test may fail before the job is loaded.
  }
  try {
    await waitFor(() => scopedAgentProcesses(fixture.root).length === 0, "isolated Agent processes to stop", 10_000);
  } catch {
    for (const line of scopedAgentProcesses(fixture.root)) {
      const pid = Number(line.trim().split(/\s+/, 1)[0]);
      if (Number.isInteger(pid)) {
        try { process.kill(pid, "SIGKILL"); } catch {}
      }
    }
    await waitFor(() => scopedAgentProcesses(fixture.root).length === 0, "forced isolated Agent cleanup", 5_000);
  }
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(fixture.cleanupRecord, { force: true });
}

function invoke(
  script: string,
  home: string,
  fakeBin: string,
  label: string,
  serverUrl: string,
  args: string[] = [],
  extraEnv: Record<string, string> = {}
): Promise<{ code: number | string; output: string }> {
  return new Promise((resolve) => {
    execFile("bash", [script, "--server-url", serverUrl, "--project-root", join(home, "project"), "--yes", ...args], {
      env: {
        ...process.env,
        ...extraEnv,
        HOME: home,
        PATH: `${fakeBin}:${process.env.PATH}`,
        TEST_NODE_MODULES: join(process.cwd(), "node_modules"),
        TEST_DEPENDENCY_CACHE: join(dirname(home), "dependency-cache", "node_modules"),
        TOKENIZER_LAUNCHD_TEST_MODE: "1",
        TOKENIZER_LAUNCHD_TEST_LABEL: label
      },
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024
    }, (error, stdout, stderr) => {
      resolve({ code: error ? (error.code ?? 1) : 0, output: stdout + stderr });
    });
  });
}

function readAgentPid(home: string): number | null {
  try {
    const state = JSON.parse(readFileSync(join(home, ".tokenizer", "state.json"), "utf8"));
    const pid = state?.agent?.status === "running" ? Number(state.agent.pid) : NaN;
    if (!Number.isInteger(pid)) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

async function waitForAgent(home: string, label: string, description: string, previousPid?: number): Promise<number> {
  try {
    return await waitFor(() => {
      const pid = readAgentPid(home);
      return pid && pid !== previousPid ? pid : null;
    }, description);
  } catch (error) {
    const log = join(home, ".tokenizer", "logs", "agent.log");
    const details = [
      error instanceof Error ? error.message : String(error),
      `launchd=${launchdJobIfPresent(label) ?? "missing"}`,
      `processes=${scopedAgentProcesses(dirname(home)).join("\n") || "missing"}`,
      `agent.log=${existsSync(log) ? readFileSync(log, "utf8") : "missing"}`
    ].join("\n");
    throw new Error(details);
  }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const fixture of fixtures.splice(0)) await stopFixture(fixture);
});

describe.skipIf(process.platform !== "darwin")("native macOS launchd pinned installer fixture", () => {
  it("installs and upgrades a live isolated service, restores it after failure, and rolls back offline without touching the default label", async () => {
    expect(() => execFileSync("launchctl", ["print", `gui/${process.getuid!()}`], { stdio: "ignore" }))
      .not.toThrow();
    if (!existsSync(join(process.cwd(), "node_modules", "tsx"))) {
      throw new Error("Native launchd fixture requires npm ci before execution");
    }

    const root = mkdtempSync(join(tmpdir(), "tokenizer-macos-launchd-"));
    const home = join(root, "home");
    const repo = join(root, "repo");
    const fakeBin = join(root, "fake-bin");
    const label = `cc.tokenizer.agent.ci.${process.pid}.${Date.now()}`;
    const plist = join(home, "Library", "LaunchAgents", `${label}.plist`);
    const cleanupRecord = join(process.cwd(), ".ci", "macos-launchd-cleanup.env");
    const fixture = { root, home, label, plist, cleanupRecord };
    fixtures.push(fixture);
    mkdirSync(dirname(cleanupRecord), { recursive: true });
    writeFileSync(cleanupRecord, [
      `TOKENIZER_FIXTURE_ROOT=${root}`,
      `TOKENIZER_FIXTURE_PLIST=${plist}`,
      `TOKENIZER_FIXTURE_LABEL=${label}`,
      ""
    ].join("\n"));
    mkdirSync(home, { recursive: true });
    mkdirSync(repo);
    mkdirSync(fakeBin);
    cpSync(join(process.cwd(), "src"), join(repo, "src"), { recursive: true });
    cpSync(join(process.cwd(), "bin"), join(repo, "bin"), { recursive: true });
    for (const file of ["package.json", "package-lock.json", "tsconfig.json"]) {
      cpSync(join(process.cwd(), file), join(repo, file));
    }
    git(repo, "init", "-q");
    const first = commitFixture(repo, "first");

    symlinkSync(process.execPath, join(fakeBin, "node"));
    writeFileSync(join(fakeBin, "npm"), `#!/usr/bin/env bash
set -euo pipefail
[ "\${1:-}" = ci ]
if [ ! -d "$TEST_DEPENDENCY_CACHE" ]; then
  mkdir -p "$(dirname "$TEST_DEPENDENCY_CACHE")"
  cp -R "$TEST_NODE_MODULES" "$TEST_DEPENDENCY_CACHE"
fi
ln -s "$TEST_DEPENDENCY_CACHE" node_modules
`);
    chmodSync(join(fakeBin, "npm"), 0o755);

    const installerSource = readFileSync("public/install.sh", "utf8")
      .replaceAll("https://github.com/tripplemay/tokenizer.git", repo);
    const script = join(root, "install.sh");
    writeFileSync(script, installerSource);
    chmodSync(script, 0o755);

    const dataDir = join(home, ".tokenizer");
    mkdirSync(dataDir, { recursive: true });
    const credentialCanary = '{"deviceToken":"credential-canary"}\n';
    const queueCanary = '{"source":"claude-code","sourceEventId":"queue-canary","occurredAt":"2026-10-08T00:00:00.000Z","repoKey":null,"gitRemote":null}\n';
    writeFileSync(join(dataDir, "credentials.json"), credentialCanary);
    writeFileSync(join(dataDir, "queue.jsonl"), queueCanary);
    writeFileSync(join(dataDir, "config.json"), `${JSON.stringify({
      serverUrl: "http://127.0.0.1:1",
      projectRoots: [join(home, "project")],
      sources: { claude: false, codex: false, opencode: false, aider: false, kimicode: false },
      privacy: { mode: "paused", includePaths: [], excludePaths: [] }
    }, null, 2)}\n`);

    let status = 200;
    let pin = first;
    const server = createServer((_request, response) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ schema_version: 1, release: { version: "1.4.0", commit: pin, repository: repo } }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing fixture server port");
    const url = `http://127.0.0.1:${address.port}`;
    const active = join(dataDir, "app");
    const defaultLabelBefore = launchdJobIfPresent("cc.tokenizer.agent") !== null;
    const assertDataRetained = () => {
      expect(readFileSync(join(dataDir, "credentials.json"), "utf8")).toBe(credentialCanary);
      expect(readFileSync(join(dataDir, "queue.jsonl"), "utf8")).toBe(queueCanary);
    };

    const fresh = await invoke(script, home, fakeBin, label, url);
    expect(fresh.code, fresh.output).toBe(0);
    expect(git(active, "rev-parse", "HEAD")).toBe(first);
    const firstPid = await waitForAgent(home, label, "first Agent child");
    const nativePlist = realpathSync(plist);
    expect(await waitFor(() => launchdJobIfPresent(label), "first launchd job")).toContain(`path = ${nativePlist}`);
    expect(readFileSync(plist, "utf8")).toContain(`<key>Label</key><string>${label}</string>`);
    assertDataRetained();

    const second = commitFixture(repo, "second");
    pin = second;
    const upgrade = await invoke(script, home, fakeBin, label, url);
    expect(upgrade.code, upgrade.output).toBe(0);
    expect(git(active, "rev-parse", "HEAD")).toBe(second);
    const secondPid = await waitForAgent(home, label, "upgraded Agent child", firstPid);
    expect(() => process.kill(firstPid, 0)).toThrow();
    expect(launchdJob(label)).toContain(`path = ${nativePlist}`);
    expect(scopedAgentProcesses(root).length).toBeGreaterThanOrEqual(1);
    assertDataRetained();

    const tokenizerBin = join(repo, "bin", "tokenizer");
    writeFileSync(tokenizerBin, readFileSync(tokenizerBin, "utf8").replace(
      "const root = resolve(dirname(fileURLToPath(import.meta.url)), \"..\");",
      "if (process.argv[2] === \"configure\" && process.env.TOKENIZER_FIXTURE_FAIL_CONFIGURE === \"1\") process.exit(42);\n\nconst root = resolve(dirname(fileURLToPath(import.meta.url)), \"..\");"
    ));
    const failing = commitFixture(repo, "failing-configure");
    pin = failing;
    const failed = await invoke(script, home, fakeBin, label, url, [], { TOKENIZER_FIXTURE_FAIL_CONFIGURE: "1" });
    expect(failed.code, failed.output).not.toBe(0);
    expect(failed.output).toContain("Upgrade failed; restoring the previous Agent");
    expect(git(active, "rev-parse", "HEAD")).toBe(second);
    const restoredPid = await waitForAgent(home, label, "restored Agent child", secondPid);
    expect(() => process.kill(secondPid, 0)).toThrow();
    expect(launchdJob(label)).toContain(`path = ${nativePlist}`);
    assertDataRetained();

    status = 503;
    const rollback = await invoke(script, home, fakeBin, label, url, ["--rollback"]);
    expect(rollback.code, rollback.output).toBe(0);
    expect(git(active, "rev-parse", "HEAD")).toBe(first);
    const rolledBackPid = await waitForAgent(home, label, "rolled-back Agent child", restoredPid);
    expect(() => process.kill(restoredPid, 0)).toThrow();
    expect(launchdJob(label)).toContain(`path = ${nativePlist}`);
    expect(launchdJobIfPresent("cc.tokenizer.agent") !== null).toBe(defaultLabelBefore);
    assertDataRetained();

    execFileSync("launchctl", ["unload", plist], { stdio: "ignore" });
    await waitFor(() => scopedAgentProcesses(root).length === 0, "final isolated Agent shutdown");
    expect(launchdJobIfPresent(label)).toBeNull();
    expect(() => process.kill(rolledBackPid, 0)).toThrow();
    console.info("B04_MACOS_LAUNCHD_FIXTURE_OBSERVATIONS", JSON.stringify({
      platform: process.platform,
      node: process.version,
      guiDomain: `gui/${process.getuid!()}`,
      label,
      freshCommit: first,
      upgradedCommit: second,
      failedCommit: failing,
      restoredCommit: second,
      offlineRollbackCommit: first,
      firstPid,
      secondPid,
      restoredPid,
      rolledBackPid,
      credentialCanaryRetained: true,
      queueCanaryRetained: true,
      defaultLabelPresentBeforeAndAfter: defaultLabelBefore,
      scopedProcessesAfterUnload: 0
    }));
  }, 240_000);
});
