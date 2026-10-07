import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("bounded replay CLI help", () => {
  it("documents the explicit file, budgets, dry-run default, and digest confirmation", () => {
    const result = spawnSync(process.execPath, [
      "--import", "tsx", join(process.cwd(), "src", "cli", "index.ts"), "replay", "--help"
    ], { cwd: process.cwd(), encoding: "utf8" });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("dry-run by default");
    expect(result.stdout).toContain("--file <absolute-jsonl>");
    expect(result.stdout).toContain("--max-bytes <bytes>");
    expect(result.stdout).toContain("--max-events <count>");
    expect(result.stdout).toContain("--execute");
    expect(result.stdout).toContain("--confirm <sha256>");
  });
});
