import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let dir: string;
const name = "agent single-instance lock reclaims a lock after Windows force-terminates the agent";

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "tokenizer-windows-owner-gate-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function check(cases: { fullName: string; status: string }[], platform = "win32", success = true) {
  const report = join(dir, "report.json");
  writeFileSync(report, JSON.stringify({
    success,
    numFailedTests: cases.filter((test) => test.status === "failed").length,
    numPassedTests: cases.filter((test) => test.status === "passed").length,
    testResults: [{ assertionResults: cases }]
  }));
  const script = join(process.cwd(), "scripts", "ci", "assert-windows-agent-owner.mjs");
  // Synthetic platform/report controls test the gate, not Windows process behavior.
  return spawnSync(process.execPath, ["--input-type=module", "-e", `
    Object.defineProperty(process, "platform", { value: ${JSON.stringify(platform)} });
    process.argv = [process.execPath, ${JSON.stringify(script)}, ${JSON.stringify(report)}];
    await import(${JSON.stringify(pathToFileURL(script).href)});
  `], { encoding: "utf8", timeout: 5_000 });
}

describe("native Windows agent owner CI gate", () => {
  it("accepts exactly one passed target on Windows", () => {
    expect(check([{ fullName: name, status: "passed" }]).status).toBe(0);
  });

  it("rejects a non-Windows runner even with a passed target", () => {
    const result = check([{ fullName: name, status: "passed" }], "darwin");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("native Windows runner");
  });

  it.each(["skipped", "pending", "failed"])("rejects a %s target", (status) => {
    expect(check([{ fullName: name, status }]).status).not.toBe(0);
  });

  it("rejects a missing or renamed target", () => {
    expect(check([]).status).not.toBe(0);
    expect(check([{ fullName: "unrelated case", status: "passed" }]).status).not.toBe(0);
  });

  it("rejects duplicate target results", () => {
    expect(check([{ fullName: name, status: "passed" }, { fullName: name, status: "passed" }]).status).not.toBe(0);
  });

  it("rejects an unsuccessful report despite a passed target", () => {
    expect(check([{ fullName: name, status: "passed" }], "win32", false).status).not.toBe(0);
  });
});
