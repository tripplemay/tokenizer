import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const exactName = "native macOS launchd pinned installer fixture installs and upgrades a live isolated service, restores it after failure, and rolls back offline without touching the default label";
let root: string;

function report(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    numFailedTests: 0,
    numPassedTests: 1,
    testResults: [{ assertionResults: [{ fullName: exactName, status: "passed" }] }],
    ...overrides
  };
}

function invoke(body: unknown, platform = "darwin") {
  const path = join(root, "report.json");
  writeFileSync(path, JSON.stringify(body));
  const script = join(process.cwd(), "scripts", "ci", "assert-macos-launchd-installer.mjs");
  // Synthetic reports/platforms test the gate only, never native launchd behavior.
  return spawnSync(process.execPath, ["--input-type=module", "-e", `
    Object.defineProperty(process, "platform", { value: ${JSON.stringify(platform)} });
    process.argv = [process.execPath, ${JSON.stringify(script)}, ${JSON.stringify(path)}];
    await import(${JSON.stringify(pathToFileURL(script).href)});
  `], { encoding: "utf8", timeout: 5_000 });
}

describe("macOS launchd native fixture gate", () => {
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "macos-launchd-gate-")); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("accepts exactly one passing native result", () => {
    expect(invoke(report()).status).toBe(0);
  });

  it("rejects another OS even when the target passed", () => {
    const result = invoke(report(), "linux");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("requires a native macOS runner");
  });

  it("makes the exact native fixture an independent prerequisite for artifacts and deploy", () => {
    const workflow = readFileSync(".github/workflows/deploy-vps.yml", "utf8");
    const job = workflow.slice(workflow.indexOf("  verify-macos-agent:"), workflow.indexOf("  verify-db:"));
    expect(job).toContain("runs-on: macos-latest");
    expect(job).toContain('launchctl print "gui/$(id -u)"');
    expect(job).toContain("tests/cli/agent-release-installer-macos.test.ts");
    expect(job).toContain("node scripts/ci/assert-macos-launchd-installer.mjs");
    expect(job).toContain("if-no-files-found: error");
    expect(workflow).toContain("needs: [verify, verify-windows, verify-macos-agent, verify-db, verify-browser]");
    expect(workflow).toContain("needs: [verify, verify-windows, verify-macos-agent, verify-db, verify-browser, release-artifact]");
  });

  it.each([
    report({ success: false }),
    report({ numFailedTests: 1 }),
    report({ numPassedTests: 0 }),
    report({ testResults: [{ assertionResults: [{ fullName: exactName, status: "skipped" }] }] }),
    report({ testResults: [{ assertionResults: [{ fullName: `${exactName} renamed`, status: "passed" }] }] }),
    report({ testResults: [{ assertionResults: [
      { fullName: exactName, status: "passed" },
      { fullName: exactName, status: "passed" }
    ] }] })
  ])("rejects missing, skipped, failed, renamed, or duplicate native evidence %#", (body) => {
    expect(invoke(body).status).not.toBe(0);
  });
});
