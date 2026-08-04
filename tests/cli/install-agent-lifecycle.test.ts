import { ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const children: ChildProcess[] = [];

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\\\''")}'`;
}

function isAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function stop(child: ChildProcess): void {
  if (isAlive(child.pid)) child.kill("SIGKILL");
}

function waitForProcessCommand(pid: number | undefined): void {
  if (!pid) throw new Error("child process did not start");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
      if (command.includes(" agent status")) return;
    } catch {
      /* the child may not have exec'd yet */
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  throw new Error(`agent fixture process ${pid} did not become visible`);
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`agent fixture ${child.pid} did not exit`)), 2_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

afterEach(() => {
  for (const child of children.splice(0)) stop(child);
});

function startNamedProcess(path: string): ChildProcess {
  const child = spawn(
    "bash",
    ["-c", "trap 'exit 0' TERM INT HUP; while :; do sleep 1; done", path, "agent", "status"],
    { stdio: "ignore" }
  );
  children.push(child);
  return child;
}

function lifecycleFunctionSource(): string {
  const source = readFileSync("public/install.sh", "utf8");
  const start = source.indexOf("agent_command_matches() {");
  const end = source.indexOf("# Decide whether enrollment is needed");
  if (start < 0 || end < start) throw new Error("install lifecycle helpers not found");
  return source.slice(start, end);
}

describe("POSIX installer Agent lifecycle", () => {
  it("stops this install's wrapper and child without touching another install", async () => {
    const home = mkdtempSync(join(tmpdir(), "tokenizer-install-home-"));
    const ownChild = startNamedProcess(join(home, ".tokenizer", "app", "src", "cli", "index.ts"));
    const ownWrapper = startNamedProcess(join(home, ".local", "bin", "tokenizer"));
    const unrelated = startNamedProcess(join(tmpdir(), "other-tokenizer", "app", "src", "cli", "index.ts"));
    const script = join(home, "stop-existing-agent.sh");

    try {
      waitForProcessCommand(ownChild.pid);
      waitForProcessCommand(ownWrapper.pid);
      waitForProcessCommand(unrelated.pid);
      writeFileSync(
        script,
        `#!/usr/bin/env bash
set -euo pipefail
HOME=${shellQuote(home)}
INSTALL_DIR="$HOME/.tokenizer/app"
BIN_DIR="$HOME/.local/bin"
log() { :; }
${lifecycleFunctionSource()}
stop_existing_agents
`
      );
      execFileSync("bash", [script], { stdio: "pipe", timeout: 20_000 });
      await waitForExit(ownChild);
      await waitForExit(ownWrapper);

      expect(isAlive(ownChild.pid)).toBe(false);
      expect(isAlive(ownWrapper.pid)).toBe(false);
      expect(isAlive(unrelated.pid)).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("uses directory-scoped matching instead of broad tokenizer-agent process search", () => {
    const source = readFileSync("public/install.sh", "utf8");
    expect(source).toContain("stop_existing_service\nstop_existing_agents");
    expect(source).toContain('"$BIN_DIR/tokenizer" uninstall-service');
    expect(source).toContain("ps -axww -o pid= -o command=");
    expect(source).not.toMatch(/^\s*pkill\s+-f\s+"tokenizer agent"/m);
    expect(source).not.toMatch(/^\s*pgrep\s+-f\s+"tokenizer agent"/m);
  });
});
