import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { preloadNodeOptions } from "../fixtures/agent-release-node-options";

describe("native Node installer failure fixture contract", () => {
  it("preserves Windows separators and spaces through the real NODE_OPTIONS parser", () => {
    const path = String.raw`C:\tokenizer fixture\fake bin\missing-preload.cjs`;
    const invoke = (options: string) => spawnSync(process.execPath, ["-e", "0"], {
      env: { ...process.env, NODE_OPTIONS: options }, encoding: "utf8", timeout: 5_000
    });
    const legacy = invoke(`--require="${path}"`);
    expect(legacy.error).toBeUndefined();
    expect(legacy.status).toBe(1);
    expect(legacy.stderr).toContain("Cannot find module 'C:tokenizer fixturefake binmissing-preload.cjs'");
    const safe = invoke(preloadNodeOptions(path));
    expect(safe.error).toBeUndefined();
    expect(safe.status).toBe(1);
    expect(safe.stderr).toContain("Cannot find module 'C:/tokenizer fixture/fake bin/missing-preload.cjs'");
  });

  it.each([ ["configure", "TEST_CONFIGURE_FAIL", 42], ["enroll", "TEST_ENROLL_FAIL", 55] ] as const)("uses real Node argv for %s and preserves the injected nonzero exit", (command, flag, exitCode) => {
    const root = mkdtempSync(join(tmpdir(), "tokenizer fixture argv-"));
    try {
      const dir = join(root, "src", "cli");
      mkdirSync(dir, { recursive: true });
      const target = join(dir, "index.ts");
      const trace = join(root, "trace.jsonl");
      const preload = join(root, "fake bin", "node-preload.cjs");
      mkdirSync(join(root, "fake bin"));
      copyFileSync("tests/fixtures/agent-release-node-preload.cjs", preload);
      writeFileSync(target, 'throw new Error("CLI target must never execute");\n');
      writeFileSync(join(root, "revision"), "candidate");
      const result = spawnSync(process.execPath, [
        "--import", "fixture-nonexistent-tsx", target, command, "--enroll-token", "synthetic-token-canary"
      ], {
        cwd: root,
        env: {
          ...process.env, HOME: root, USERPROFILE: root,
          NODE_OPTIONS: preloadNodeOptions(preload),
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
