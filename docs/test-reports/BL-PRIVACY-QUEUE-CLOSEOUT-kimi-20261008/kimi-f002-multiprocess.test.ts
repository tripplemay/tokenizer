// Independent F002 runner for the Kimi multiprocess/HTTP probe.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("F002 independent two-process + loopback HTTP controls", () => {
  it("merge storm, versioned quarantine, quarantine failure and crash/retry", async () => {
    const tsx = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    const probe = join(process.cwd(), "tests", "cli", "kimi-f002-multiprocess.probe.ts");
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [tsx, probe], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("exit", (code) => resolve({ code, stdout, stderr }));
    });

    expect(result.code, result.stderr).toBe(0);
    const observation = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    expect(observation).toEqual({
      mergeStorm: { lines: 25, mode: "600" },
      versionedQuarantine: [2, 3],
      quarantineFailure: { preservedBytes: true, retriedToEmpty: true },
      crashRetry: { queueAfterRetry: 0, serverRequests: 2 }
    });
  }, 60_000);
});
