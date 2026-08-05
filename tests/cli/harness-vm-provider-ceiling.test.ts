import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Evaluator regression guard — BL-TOKENIZER-ADOPT-V170 F002.
 *
 * The TS catalog mirror only publishes the vm-v1 subagent bridge when every
 * runtime file passes a byte-identity trust check, and that check reads each
 * file through `regularFileUnder(..., MAX_PROVIDER_BYTES)`. An oversized but
 * otherwise valid provider makes that helper return null, which makes the
 * whole proof return null — the bridge silently disappears instead of raising.
 *
 * Adopting framework v1.7.0 shipped a 133 KB A-lineage provider against a
 * 128 KB ceiling and hit exactly that failure mode. These assertions fail loudly
 * the next time the provider outgrows the ceiling.
 */

const CATALOG_SOURCE = "src/cli/harness-tool-catalog.ts";
const TEMPLATE_TRANSPORTS = "framework/templates/claude/dispatch/transports";
const PROJECT_TRANSPORTS = ".claude/dispatch/transports";
const VM_BRIDGE_RUNTIME_FILES = [
  "vm-bridge-provider.py",
  "session-bridge.py",
  "session_bridge_kimi.py",
  "vm-bridge-worker.py"
] as const;

function repoPath(...parts: string[]): string {
  return join(process.cwd(), ...parts);
}

/** Reads the ceiling from source so the guard tracks the real constant. */
function declaredProviderCeiling(): number {
  const source = readFileSync(repoPath(CATALOG_SOURCE), "utf8");
  const match = /const MAX_PROVIDER_BYTES = (\d+) \* 1024;/.exec(source);
  expect(match, `${CATALOG_SOURCE} must declare MAX_PROVIDER_BYTES`).not.toBeNull();
  return Number(match![1]) * 1024;
}

describe("vm-v1 bridge runtime fits the catalog trust-check ceiling", () => {
  it("keeps every bundled runtime file under MAX_PROVIDER_BYTES", () => {
    const ceiling = declaredProviderCeiling();

    for (const filename of VM_BRIDGE_RUNTIME_FILES) {
      const bytes = statSync(repoPath(TEMPLATE_TRANSPORTS, filename)).size;
      expect(
        bytes,
        `${filename} is ${bytes}B and exceeds the ${ceiling}B ceiling — the catalog ` +
          "would silently stop publishing the vm-v1 bridge instead of failing loudly"
      ).toBeLessThan(ceiling);
    }
  });

  it("documents that the v1.7.0 provider outgrew the historical 128 KB ceiling", () => {
    const providerBytes = statSync(repoPath(TEMPLATE_TRANSPORTS, "vm-bridge-provider.py")).size;

    expect(providerBytes).toBeGreaterThan(128 * 1024);
    expect(declaredProviderCeiling()).toBeGreaterThanOrEqual(256 * 1024);
  });

  it("keeps the project copies byte-identical to the bundled templates", () => {
    for (const filename of VM_BRIDGE_RUNTIME_FILES) {
      const project = readFileSync(repoPath(PROJECT_TRANSPORTS, filename));
      const bundled = readFileSync(repoPath(TEMPLATE_TRANSPORTS, filename));
      expect(
        project.equals(bundled),
        `${filename} differs between ${PROJECT_TRANSPORTS} and ${TEMPLATE_TRANSPORTS}`
      ).toBe(true);
    }
  });
});
