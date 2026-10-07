import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let sandbox: string;

function nativeStep(bindTemp = true): string {
  const workflow = readFileSync(".github/workflows/deploy-vps.yml", "utf8");
  const name = workflow.indexOf("      - name: Verify native macOS launchd pinned installer\n");
  const start = workflow.indexOf("        run: |\n", name) + "        run: |\n".length;
  const end = workflow.indexOf("      - name: Upload native macOS launchd installer evidence\n", start);
  if (name < 0 || start < "        run: |\n".length || end < 0) throw new Error("Native macOS workflow step not found");
  const step = workflow.slice(start, end).split("\n").map((line) => line.replace(/^ {10}/, "")).join("\n");
  if (bindTemp) return step;
  const binding = [
    ': "${RUNNER_TEMP:?RUNNER_TEMP is required for native fixture cleanup}"',
    'RUNNER_TEMP="$(cd "$RUNNER_TEMP" && pwd -P)"',
    'TMPDIR="$RUNNER_TEMP"',
    "export RUNNER_TEMP TMPDIR"
  ].join("\n");
  if (!step.includes(binding)) throw new Error("Native fixture temp binding not found");
  return step.replace(binding, "");
}

function executable(path: string, body: string): void {
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(path, 0o755);
}

function runInterruptedStep(outOfScope = false, bindTemp = true) {
  const runnerTemp = join(sandbox, "runner-temp");
  const nodeTemp = join(sandbox, "node-temp");
  const outsideTemp = join(sandbox, "outside-temp");
  const fakeBin = join(sandbox, "fake-bin");
  for (const dir of [runnerTemp, nodeTemp, outsideTemp, fakeBin]) mkdirSync(dir);
  const launchctlCalls = join(sandbox, "launchctl-calls.txt");
  executable(join(fakeBin, "npx"), [
    "set -euo pipefail",
    ...(bindTemp ? [
      '[[ "$TMPDIR" = "$RUNNER_TEMP" ]] || exit 65',
      '[[ "$(node -p \'require("node:os").tmpdir()\')" = "$RUNNER_TEMP" ]] || exit 66'
    ] : []),
    'fixture_root="$(mktemp -d "${FIXTURE_ROOT_BASE:-$TMPDIR}/tokenizer-macos-launchd-XXXXXX")"',
    'plist="$fixture_root/home/Library/LaunchAgents/cc.tokenizer.agent.ci.probe.plist"',
    'mkdir -p "$(dirname "$plist")"',
    'touch "$plist"',
    'printf "TOKENIZER_FIXTURE_ROOT=%s\\nTOKENIZER_FIXTURE_PLIST=%s\\nTOKENIZER_FIXTURE_LABEL=cc.tokenizer.agent.ci.probe\\n" "$fixture_root" "$plist" > .ci/macos-launchd-cleanup.env',
    'printf "%s\\n" "$fixture_root" > observed-root.txt',
    "exit 42"
  ].join("\n"));
  executable(join(fakeBin, "launchctl"), 'printf "%s\\n" "$*" >> "$LAUNCHCTL_CALLS"');
  for (const command of ["ps", "sleep", "xargs"]) executable(join(fakeBin, command), "exit 0");
  const run = spawnSync("bash", ["-c", nativeStep(bindTemp)], {
    cwd: sandbox,
    env: {
      ...process.env,
      RUNNER_TEMP: runnerTemp,
      TMPDIR: nodeTemp,
      FIXTURE_ROOT_BASE: outOfScope ? outsideTemp : "",
      LAUNCHCTL_CALLS: launchctlCalls,
      PATH: `${fakeBin}:${process.env.PATH}`
    },
    encoding: "utf8",
    timeout: 10_000
  });
  const root = readFileSync(join(sandbox, "observed-root.txt"), "utf8").trim();
  return { run, root, runnerTemp, nodeTemp, launchctlCalls,
    cleanupRecord: join(sandbox, ".ci", "macos-launchd-cleanup.env") };
}

describe.skipIf(process.platform === "win32")("native macOS workflow abnormal-exit cleanup", () => {
  beforeEach(() => { sandbox = mkdtempSync(join(tmpdir(), "b04-macos-trap-")); });
  afterEach(() => rmSync(sandbox, { recursive: true, force: true }));

  it("overrides a different Node temp directory and cleans the interrupted fixture", () => {
    const { run, root, runnerTemp, nodeTemp, launchctlCalls, cleanupRecord } = runInterruptedStep();
    expect(nodeTemp).not.toBe(runnerTemp);
    expect(run.status, run.stderr).toBe(42);
    expect(root.startsWith(`${realpathSync(runnerTemp)}/tokenizer-macos-launchd-`)).toBe(true);
    expect(existsSync(root)).toBe(false);
    expect(existsSync(cleanupRecord)).toBe(false);
    expect(readFileSync(launchctlCalls, "utf8")).toContain("unload ");
  });

  it("refuses to delete an out-of-scope cleanup record on abnormal exit", () => {
    const { run, root, launchctlCalls, cleanupRecord } = runInterruptedStep(true);
    expect(run.status, run.stderr).toBe(42);
    expect(run.stderr).toContain("Refusing an out-of-scope launchd fixture cleanup record");
    expect(existsSync(root)).toBe(true);
    expect(existsSync(cleanupRecord)).toBe(true);
    expect(existsSync(launchctlCalls)).toBe(false);
  });

  it("negative control: without the temp binding, an interrupted fixture is orphaned", () => {
    const { run, root, launchctlCalls, cleanupRecord } = runInterruptedStep(false, false);
    expect(run.status, run.stderr).toBe(42);
    expect(run.stderr).toContain("Refusing an out-of-scope launchd fixture cleanup record");
    expect(existsSync(root)).toBe(true);
    expect(existsSync(cleanupRecord)).toBe(true);
    expect(existsSync(launchctlCalls)).toBe(false);
  });
});
