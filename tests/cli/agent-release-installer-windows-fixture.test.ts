import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("native Node installer failure fixture contract", () => {
  it.each([ ["configure", "TEST_CONFIGURE_FAIL", 42], ["enroll", "TEST_ENROLL_FAIL", 55] ] as const)("uses real Node argv for %s and preserves the injected nonzero exit", (command, flag, exitCode) => {
    const root = mkdtempSync(join(tmpdir(), "tokenizer fixture argv-"));
    try {
      const dir = join(root, "src", "cli");
      mkdirSync(dir, { recursive: true });
      const target = join(dir, "index.ts");
      const trace = join(root, "trace.jsonl");
      writeFileSync(target, 'throw new Error("CLI target must never execute");\n');
      writeFileSync(join(root, "revision"), "candidate");
      const result = spawnSync(process.execPath, [
        "--import", "fixture-nonexistent-tsx", target, command, "--enroll-token", "synthetic-token-canary"
      ], {
        cwd: root,
        env: {
          ...process.env, HOME: root, USERPROFILE: root,
          NODE_OPTIONS: `--require="${join(process.cwd(), "tests", "fixtures", "agent-release-node-preload.cjs")}"`,
          TEST_CLI_TRACE: trace, [flag]: "1"
        },
        encoding: "utf8", timeout: 5_000
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(exitCode);
      const text = readFileSync(trace, "utf8");
      expect(JSON.parse(text)).toEqual({ command, exitCode, revision: "candidate" });
      expect(text).not.toContain("synthetic-token-canary");
      expect(result.stderr).not.toContain("fixture-nonexistent-tsx");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
