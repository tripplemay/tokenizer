import { execFile, execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const servers: Server[] = [];

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function commitFixture(repo: string, revision: string): string {
  writeFileSync(join(repo, "revision"), revision);
  git(repo, "add", ".");
  git(repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", revision);
  return git(repo, "rev-parse", "HEAD");
}

function startInstaller(script: string, home: string, fakeBin: string, serverUrl: string, args: string[] = [], extraEnv: Record<string, string> = {}, withService = false) {
  let finish!: (result: { code: number | string; output: string }) => void;
  const result = new Promise<{ code: number | string; output: string }>((resolve) => { finish = resolve; });
  const env: NodeJS.ProcessEnv = {
    ...process.env, ...extraEnv,
    NODE_OPTIONS: `--require="${join(fakeBin, "node-preload.cjs")}"`,
    TEST_CLI_TRACE: join(home, "cli-trace.jsonl"),
    TEST_TASK_TRACE: join(home, "task-trace.txt")
  };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "path") delete env[key];
  }
  env.Path = `${fakeBin};${process.env.Path ?? process.env.PATH}`;
  const child = execFile("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script,
    "-ServerUrl", serverUrl, "-ProjectRoot", home, ...(withService ? [] : ["-NoService"]), ...args
  ], {
    env,
    timeout: 90_000,
    maxBuffer: 2 * 1024 * 1024
  }, (error, stdout, stderr) => {
    finish({ code: error ? (error.code ?? 1) : 0, output: stdout + stderr });
  });
  return { child, result };
}

async function invoke(script: string, home: string, fakeBin: string, serverUrl: string, args: string[] = [], extraEnv: Record<string, string> = {}, withService = false) {
  return startInstaller(script, home, fakeBin, serverUrl, args, extraEnv, withService).result;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform !== "win32")("native Windows pinned installer fixture", () => {
  it("installs, rejects failures and concurrency, then rolls back offline without leaking enrollment tokens", async () => {
    const root = mkdtempSync(join(tmpdir(), "tokenizer win-release-"));
    roots.push(root);
    const home = join(root, "home");
    const repo = join(root, "repo");
    const fakeBin = join(root, "fake bin");
    const dataDir = join(home, ".tokenizer");
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(repo, "src", "cli"), { recursive: true });
    mkdirSync(fakeBin);
    git(repo, "init", "-q");
    writeFileSync(join(repo, "src", "cli", "index.ts"), "// fixture\n");
    const first = commitFixture(repo, "first");
    const holdScript = join(root, "hold.js");
    writeFileSync(holdScript, "const fs=require('node:fs');const p=process.env.TEST_NPM_HOLD;fs.writeFileSync(p+'.ready','');const t=setInterval(()=>{if(!fs.existsSync(p)){clearInterval(t);process.exit(0)}},50);\n");
    // The installed .cmd shim launches node.exe in production. A nested
    // node.cmd mock changes batch control/exit semantics and cannot model it.
    copyFileSync(process.execPath, join(fakeBin, "node.exe"));
    copyFileSync("tests/fixtures/agent-release-node-preload.cjs", join(fakeBin, "node-preload.cjs"));
    writeFileSync(join(fakeBin, "npm.cmd"), [
      "@echo off",
      'if "%TEST_NPM_FAIL%"=="1" exit /b 33',
      `if not "%TEST_NPM_HOLD%"=="" "${process.execPath}" "${holdScript}"`,
      "exit /b 0",
      ""
    ].join("\r\n"));
    writeFileSync(join(fakeBin, "schtasks.cmd"), '@echo off\r\necho %*>> "%TEST_TASK_TRACE%"\r\nexit /b 0\r\n');

    const source = readFileSync("public/install.ps1", "utf8");
    const script = join(root, "install.ps1");
    const fixtureSource = source
      .replaceAll("https://github.com/tripplemay/tokenizer.git", repo)
      .replace('Join-Path $HOME ".tokenizer"', `Join-Path '${home.replaceAll("'", "''")}' ".tokenizer"`)
      .replace("Add-ToUserPath -Directory $BinDir", 'Write-Log "Fixture: user PATH unchanged"');
    writeFileSync(script, fixtureSource);
    writeFileSync(join(dataDir, "queue.jsonl"), "queue-canary");
    let status = 200;
    let pin = first;
    const server = createServer((_request, response) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ schema_version: 1, release: { version: "1.4.0", commit: pin, repository: repo } }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test server port");
    const url = `http://127.0.0.1:${address.port}`;
    const active = join(dataDir, "app");
    const trace = () => readFileSync(join(home, "cli-trace.jsonl"), "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
    const assertOldData = () => {
      expect(git(active, "rev-parse", "HEAD")).toBe(first);
      expect(readFileSync(join(dataDir, "credentials.json"), "utf8")).toBe("credential-canary");
      expect(readFileSync(join(dataDir, "queue.jsonl"), "utf8")).toBe("queue-canary");
    };

    const fresh = await invoke(script, home, fakeBin, url, ["-EnrollToken", "fresh-token"]);
    expect(fresh.code, fresh.output).toBe(0);
    expect(git(active, "rev-parse", "HEAD")).toBe(first);
    writeFileSync(join(dataDir, "credentials.json"), "credential-canary");
    const second = commitFixture(repo, "second");
    pin = second;

    status = 503;
    expect((await invoke(script, home, fakeBin, url)).code).not.toBe(0);
    assertOldData();
    status = 200;
    pin = "0".repeat(40);
    expect((await invoke(script, home, fakeBin, url)).code).not.toBe(0);
    assertOldData();
    pin = second;
    expect((await invoke(script, home, fakeBin, url, [], { TEST_NPM_FAIL: "1" })).code).not.toBe(0);
    assertOldData();
    const failedConfig = await invoke(script, home, fakeBin, url, [], { TEST_CONFIGURE_FAIL: "1" });
    expect(failedConfig.code, failedConfig.output).not.toBe(0);
    expect(trace().at(-1)).toEqual({ command: "configure", exitCode: 42, revision: "second" });
    assertOldData();
    const failedServiceConfig = await invoke(script, home, fakeBin, url, [], { TEST_CONFIGURE_FAIL: "1" }, true);
    expect(failedServiceConfig.code, failedServiceConfig.output).not.toBe(0);
    expect(trace().slice(-2)).toEqual([
      { command: "configure", exitCode: 42, revision: "second" },
      { command: "install-service", exitCode: 0, revision: "first" }
    ]);
    assertOldData();
    const sensitive = await invoke(script, home, fakeBin, url, ["-ForceEnroll", "-EnrollToken", "enroll-secret-canary"], { TEST_ENROLL_FAIL: "1" });
    expect(sensitive.code).not.toBe(0);
    expect(sensitive.output).not.toContain("enroll-secret-canary");
    expect(trace().at(-1)).toEqual({ command: "enroll", exitCode: 55, revision: "second" });
    assertOldData();

    const hold = join(root, "hold-npm");
    writeFileSync(hold, "hold");
    const held = startInstaller(script, home, fakeBin, url, [], { TEST_NPM_HOLD: hold });
    try {
      for (let attempt = 0; attempt < 200 && !existsSync(`${hold}.ready`); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(existsSync(`${hold}.ready`)).toBe(true);
      const concurrent = await invoke(script, home, fakeBin, url);
      expect(concurrent.code).not.toBe(0);
      expect(concurrent.output).toContain("Another Tokenizer installation is running");
    } finally {
      if (existsSync(hold)) unlinkSync(hold);
    }
    const completed = await held.result;
    expect(completed.code, completed.output).toBe(0);
    expect(git(active, "rev-parse", "HEAD")).toBe(second);

    status = 503;
    const rollback = await invoke(script, home, fakeBin, url, ["-Rollback"]);
    expect(rollback.code, rollback.output).toBe(0);
    expect(git(active, "rev-parse", "HEAD")).toBe(first);
    expect(readFileSync(join(dataDir, "credentials.json"), "utf8")).toBe("credential-canary");
    expect(readFileSync(join(dataDir, "queue.jsonl"), "utf8")).toBe("queue-canary");
    expect(existsSync(join(dataDir, ".install.lock"))).toBe(true);
    console.info("B04_NATIVE_FIXTURE_OBSERVATIONS", JSON.stringify({
      platform: process.platform, node: process.version,
      configFailureExit: failedConfig.code, serviceConfigFailureExit: failedServiceConfig.code,
      enrollmentFailureExit: sensitive.code, completedUpgradeExit: completed.code,
      offlineRollbackExit: rollback.code, activeCommitAfterRollback: git(active, "rev-parse", "HEAD"),
      expectedOldCommit: first, queueCanaryRetained: true, credentialCanaryRetained: true
    }));
  }, 180_000);
});
