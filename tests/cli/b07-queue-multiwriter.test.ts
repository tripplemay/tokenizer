import { spawn } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("B07 native two-process queue liveness", () => {
  it("preserves concurrent collection, newer versions and crash retries over real HTTP", async () => {
    const tsx = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    const probe = join(process.cwd(), "tests", "cli", "b07-queue-multiwriter.probe.ts");
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
      concurrent: { queue: ["newly-collected"], rejected: ["poison"] },
      version: [{ id: "same-id", inputTokens: 2 }],
      crashRetry: [],
      priorServerRowless: {
        requests: [
          ["rowless-good-a", "rowless-poison", "rowless-good-b"],
          ["rowless-good-a", "rowless-poison"],
          ["rowless-good-a"],
          ["rowless-poison", "rowless-good-b"],
          ["rowless-poison"],
          [],
          ["rowless-good-b"]
        ],
        queue: [],
        rejected: ["poison", "rowless-poison"]
      }
    });
  }, 30_000);
});
