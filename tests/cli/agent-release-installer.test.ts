import { execFile, execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const servers: Server[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function commitFixture(repo: string, revision: string): string {
  writeFileSync(join(repo, "revision"), revision);
  git(repo, "add", ".");
  git(repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", revision);
  return git(repo, "rev-parse", "HEAD");
}

function startInstaller(script: string, home: string, fakeBin: string, serverUrl: string, args: string[] = [], extraEnv: Record<string, string> = {}) {
  let finish!: (result: { code: number | string; output: string }) => void;
  const result = new Promise<{ code: number | string; output: string }>((resolve) => { finish = resolve; });
  const child = execFile("bash", [script, "--no-service", ...args], {
    env: { ...process.env, HOME: home, PATH: `${fakeBin}:${process.env.PATH}`, TOKENIZER_SERVER_URL: serverUrl, ...extraEnv },
    timeout: 60_000
  }, (error, stdout, stderr) => {
    finish({ code: error ? (error.code ?? 1) : 0, output: stdout + stderr });
  });
  return { child, result };
}

async function invoke(script: string, home: string, fakeBin: string, serverUrl: string, args: string[] = [], extraEnv: Record<string, string> = {}) {
  return startInstaller(script, home, fakeBin, serverUrl, args, extraEnv).result;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("pinned POSIX Agent installer", () => {
  it("keeps the old release and data on manifest, fetch, or npm failure; upgrades and rolls back", async () => {
    const root = mkdtempSync(join(tmpdir(), "tokenizer-release-test-"));
    roots.push(root);
    const home = join(root, "home");
    const repo = join(root, "repo");
    const fakeBin = join(root, "fake-bin");
    mkdirSync(home);
    mkdirSync(repo);
    mkdirSync(fakeBin);
    mkdirSync(join(repo, "bin"));
    mkdirSync(join(repo, "src", "cli"), { recursive: true });
    git(repo, "init", "-q");
    writeFileSync(join(repo, "bin", "tokenizer"), "#!/bin/sh\nif [ \"$1\" = configure ] && [ \"$TEST_CONFIGURE_FAIL\" = 1 ]; then exit 42; fi\nexit 0\n");
    writeFileSync(join(repo, "src", "cli", "index.ts"), "// fixture\n");
    const first = commitFixture(repo, "first");
    writeFileSync(join(fakeBin, "node"), `#!/bin/sh\nif [ "$1" = --import ]; then exit 0; fi\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 });
    writeFileSync(join(fakeBin, "npm"), "#!/bin/sh\nif [ \"$TEST_NPM_FAIL\" = 1 ]; then exit 33; fi\nif [ -n \"$TEST_NPM_HOLD\" ]; then touch \"$TEST_NPM_HOLD.ready\"; while [ -e \"$TEST_NPM_HOLD\" ]; do sleep 0.1; done; fi\nexit 0\n", { mode: 0o755 });
    const source = readFileSync("public/install.sh", "utf8");
    const script = join(root, "install.sh");
    writeFileSync(script, source.replaceAll("https://github.com/tripplemay/tokenizer.git", repo));
    const dataDir = join(home, ".tokenizer");
    mkdirSync(dataDir);
    writeFileSync(join(dataDir, "credentials.json"), "credential-canary");
    writeFileSync(join(dataDir, "queue.jsonl"), "queue-canary");
    const lock = join(dataDir, ".install.lock");
    mkdirSync(lock);
    writeFileSync(join(lock, "owner"), "999999999|stale process\n");
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

    const initialInstall = await invoke(script, home, fakeBin, url);
    expect(initialInstall.code, initialInstall.output).toBe(0);
    expect(existsSync(lock)).toBe(false);
    const active = join(dataDir, "app");
    expect(git(active, "rev-parse", "HEAD")).toBe(first);
    const firstPath = realpathSync(active);
    const second = commitFixture(repo, "second");
    pin = second;

    status = 503;
    expect((await invoke(script, home, fakeBin, url)).code).not.toBe(0);
    expect(realpathSync(active)).toBe(firstPath);

    status = 200;
    pin = "0".repeat(40);
    expect((await invoke(script, home, fakeBin, url)).code).not.toBe(0);
    expect(realpathSync(active)).toBe(firstPath);

    pin = second;
    expect((await invoke(script, home, fakeBin, url, [], { TEST_NPM_FAIL: "1" })).code).not.toBe(0);
    expect(realpathSync(active)).toBe(firstPath);

    expect((await invoke(script, home, fakeBin, url, [], { TEST_CONFIGURE_FAIL: "1" })).code).not.toBe(0);
    expect(realpathSync(active)).toBe(firstPath);

    const hold = join(root, "hold-npm");
    writeFileSync(hold, "hold");
    const held = startInstaller(script, home, fakeBin, url, [], { TEST_NPM_HOLD: hold });
    try {
      for (let attempt = 0; attempt < 120 && !existsSync(`${hold}.ready`); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(existsSync(`${hold}.ready`)).toBe(true);
      const concurrent = await invoke(script, home, fakeBin, url);
      expect(concurrent.code).not.toBe(0);
      expect(concurrent.output).toContain("Another Tokenizer installation is running");
      expect(realpathSync(active)).toBe(firstPath);
    } finally {
      held.child.kill("SIGKILL");
      if (existsSync(hold)) unlinkSync(hold);
      await held.result;
    }
    expect(existsSync(lock)).toBe(true);
    expect(realpathSync(active)).toBe(firstPath);
    const recoveredUpgrade = await invoke(script, home, fakeBin, url);
    expect(recoveredUpgrade.code, recoveredUpgrade.output).toBe(0);
    expect(git(active, "rev-parse", "HEAD")).toBe(second);
    const previous = join(dataDir, "previous");
    expect(realpathSync(previous)).toBe(firstPath);

    unlinkSync(previous);
    symlinkSync(repo, previous);
    const escapedRollback = await invoke(script, home, fakeBin, url, ["--rollback"]);
    expect(escapedRollback.code).not.toBe(0);
    expect(escapedRollback.output).toContain("outside the Agent releases directory");
    expect(git(active, "rev-parse", "HEAD")).toBe(second);
    unlinkSync(previous);
    symlinkSync(firstPath, previous);
    status = 503;
    expect((await invoke(script, home, fakeBin, url, ["--rollback"])).code).toBe(0);
    expect(git(active, "rev-parse", "HEAD")).toBe(first);
    expect(readFileSync(join(dataDir, "credentials.json"), "utf8")).toBe("credential-canary");
    expect(readFileSync(join(dataDir, "queue.jsonl"), "utf8")).toBe("queue-canary");
  }, 90_000);
});

describe("Windows installer release boundary", () => {
  function assertStagedBeforeStop(source: string) {
    const stage = source.search(/^\s+Invoke-Checked npm ci\r?$/m);
    const stop = source.search(/^\s+Stop-RunningAgent\r?$/m);
    expect(stage).toBeGreaterThanOrEqual(0);
    expect(stop).toBeGreaterThan(stage);
  }

  it.each(["LF", "CRLF"])("does not chase main and stages before stopping the running task (%s)", (newline) => {
    const original = readFileSync("public/install.ps1", "utf8").replace(/\r\n/g, "\n");
    const source = newline === "CRLF" ? original.replace(/\n/g, "\r\n") : original;
    expect(source).toContain('/api/agent/releases');
    expect(source).toContain("Agent commit digest mismatch");
    expect(source).toContain("Invoke-Checked npm ci");
    expect(source).toContain("[IO.FileShare]::None");
    expect(source).toContain("$Arguments -contains \"--enroll-token\"");
    expect(source).toContain("& $Exe @Arguments *> $null");
    expect(source).not.toContain("$($Arguments -join ' ')");
    expect(source).not.toContain('"origin/$Branch"');
    assertStagedBeforeStop(source);
  });

  it("rejects a missing or premature stop boundary instead of passing absent indexes", () => {
    const source = readFileSync("public/install.ps1", "utf8").replace(/\r\n/g, "\n");
    const noStop = source.replace(/^\s+Stop-RunningAgent$/m, "");
    expect(() => assertStagedBeforeStop(noStop)).toThrow();
    expect(() => assertStagedBeforeStop(`  Stop-RunningAgent\n${noStop}`)).toThrow();
  });
});
