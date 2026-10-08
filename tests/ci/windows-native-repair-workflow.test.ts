import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transpileModule } from "typescript";
import { describe, expect, it } from "vitest";

const fixture = readFileSync("tests/ci/vps-host-preflight.test.ts", "utf8");
const start = fixture.indexOf("function workflowJob(");
const end = fixture.indexOf("\nfunction inventoryStep(", start);
if (start < 0 || end < 0) throw new Error("missing real host-preflight fixture extractor");
// Evaluate the real pure helper without re-registering the old test suites.
const helper = transpileModule(fixture.slice(start, end), {}).outputText;
const workflow = readFileSync(".github/workflows/deploy-vps.yml", "utf8").replace(/\r\n/g, "\n");
const extract = (text: string, name: string, until?: string): string =>
  runInNewContext(`${helper}\nworkflowJob(text, name, until)`, { text, name, until });
const gates = ["verify", "verify-windows", "verify-macos-agent", "verify-db", "verify-browser", "release-artifact"];
const guard = "if: github.event_name != 'workflow_dispatch' || inputs.operation == 'release'";

describe("real host-preflight fixture newline extraction controls", () => {
  it.each(gates)("extracts the same guarded %s job from LF and CRLF", (name) => {
    const lf = extract(workflow, name);
    const crlf = extract(workflow.replace(/\n/g, "\r\n"), name);
    expect(crlf).toBe(lf);
    expect(lf.startsWith(`  ${name}:\n`)).toBe(true);
    expect(lf).toContain(guard);
    expect(lf.slice(1)).not.toMatch(/\n  [a-z][a-z-]+:\n/);
  });

  it("keeps LF/CRLF inventory separate from release and preserves all release needs", () => {
    for (const text of [workflow, workflow.replace(/\n/g, "\r\n")]) {
      const job = extract(text, "host-preflight", "verify");
      expect(job).toContain("if: github.event_name == 'workflow_dispatch' && inputs.operation == 'host-preflight'");
      expect(job).not.toMatch(/npm ci|build-push|docker\/login|rsync|\bscp\b|rehearse-release|migrate deploy|deploy-vps-release|REGISTRY_TOKEN|AUTH_SECRET|POSTGRES_PASSWORD/);
      expect(job).toContain("< scripts/ci/vps-host-preflight.sh");
      expect(job).toContain("timeout --signal=KILL 150s ssh");
      expect(job).toContain("path: host-preflight-evidence/inventory.json");
      expect(extract(text, "deploy")).toContain("needs: [verify, verify-windows, verify-macos-agent, verify-db, verify-browser, release-artifact]");
    }
  });

  it.each(["\n", "\r\n"])("refuses a missing selected heading rather than slicing from -1 (%j)", (newline) => {
    const text = workflow.replace(/\n/g, newline).replace(`  verify:${newline}`, `  removed-verify:${newline}`);
    expect(() => extract(text, "verify")).toThrow("missing workflow job heading: verify");
  });

  it.each(["\n", "\r\n"])("refuses a missing inventory end heading (%j)", (newline) => {
    const text = workflow.replace(/\n/g, newline).replace(`  verify:${newline}`, `  removed-verify:${newline}`);
    expect(() => extract(text, "host-preflight", "verify")).toThrow("missing workflow job heading: verify");
  });
});
