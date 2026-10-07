import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BoundedSubprocessOutputError,
  BoundedSubprocessTimeoutError,
  runBoundedSubprocess
} from "@/cli/bounded-subprocess";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("bounded replay subprocess", () => {
  it("returns at the direct-process timeout when a descendant retains stdout", () => {
    const cwd = mkdtempSync(join(realpathSync(tmpdir()), "bounded-process-"));
    roots.push(cwd);
    const child = [
      "const { spawn } = require('node:child_process');",
      "spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: ['ignore', 'inherit', 'ignore'] });",
      "setTimeout(() => {}, 30000);"
    ].join("");
    const started = Date.now();

    expect(() => runBoundedSubprocess(process.execPath, ["-e", child], {
      cwd,
      timeoutMs: 100,
      maxOutputBytes: 1024,
      windowsHide: true
    })).toThrow(BoundedSubprocessTimeoutError);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("kills an output flood as soon as the streaming cap is crossed", () => {
    const started = Date.now();
    expect(() => runBoundedSubprocess(process.execPath, [
      "-e", "for (;;) process.stdout.write('x'.repeat(65536))"
    ], {
      timeoutMs: 2_000,
      maxOutputBytes: 1024,
      windowsHide: true
    })).toThrow(BoundedSubprocessOutputError);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("waits for descendant termination before returning from a timeout", () => {
    const cwd = mkdtempSync(join(realpathSync(tmpdir()), "bounded-tree-"));
    roots.push(cwd);
    const marker = join(cwd, "orphan-marker");
    const descendant = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'orphan'), 1500)`;
    const parent = [
      "const { spawn } = require('node:child_process');",
      `spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: ['ignore', 'inherit', 'ignore'] });`,
      "setTimeout(() => {}, 30000);"
    ].join("");

    expect(() => runBoundedSubprocess(process.execPath, ["-e", parent], {
      cwd,
      timeoutMs: 100,
      maxOutputBytes: 1024,
      windowsHide: true
    })).toThrow(BoundedSubprocessTimeoutError);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2_000);
    expect(existsSync(marker)).toBe(false);
  }, 5_000);

  it("ships the plain-JavaScript worker in both full-checkout installer paths", () => {
    expect(existsSync("src/cli/bounded-subprocess-worker.mjs")).toBe(true);
    const posix = readFileSync("public/install.sh", "utf8");
    const windows = readFileSync("public/install.ps1", "utf8");
    expect(posix).toContain('git -C "$STAGE_DIR" checkout --detach --force "$PIN_COMMIT"');
    expect(posix).toContain("node --import tsx src/cli/index.ts --help");
    expect(windows).toContain("Invoke-Checked git -C $stageDir checkout --detach --force $release.commit");
    expect(windows).toContain('Invoke-Checked node --import tsx "src\\cli\\index.ts" --help');
  });

});
