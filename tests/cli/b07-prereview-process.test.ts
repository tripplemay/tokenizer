import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { UsageEventInput } from "@/shared/usage";

function event(tokens: number): UsageEventInput { return { source: "aider", sourceEventId: "same-id", occurredAt: "2026-10-08T00:00:00.000Z", inputTokens: tokens, totalTokens: tokens }; }
function command(home: string, operation: string, events: UsageEventInput[] = []) {
  const child = spawnSync(process.execPath, ["--import", "tsx", join(process.cwd(), "tests/fixtures/b07-prereview-worker.ts"), operation, JSON.stringify(events)], { encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home }, timeout: 5000 });
  expect(child.error).toBeUndefined(); expect(child.status, child.stderr).toBe(0); return JSON.parse(child.stdout) as { active: UsageEventInput[]; rejected: { event: UsageEventInput }[] };
}

it("separate native processes must not lose rejected correction after old same-ID quarantine", () => {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "b07-process-negative-"));
  try {
    command(home, "merge", [event(1)]); command(home, "reject", [event(1)]); command(home, "merge", [event(200)]); const state = command(home, "reject", [event(200)]);
    console.log("MULTIPROCESS_QUARANTINE_NEGATIVE", JSON.stringify(state)); expect([...state.active, ...state.rejected.map((row) => row.event)].some((entry) => entry.inputTokens === 200)).toBe(true);
  } finally { rmSync(home, { recursive: true, force: true }); }
}, 15_000);

it("eight simultaneous native writers preserve same-ID distinct versions, exact ACK, and owner-only new files", async () => {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "b07-process-control-"));
  try {
    const writes = Array.from({ length: 8 }, (_, index) => event(index + 1));
    await Promise.all(writes.map((entry) => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", join(process.cwd(), "tests/fixtures/b07-prereview-worker.ts"), "merge", JSON.stringify([entry])], { env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: ["ignore", "pipe", "pipe"] });
      let stderr = ""; child.stderr.on("data", (part) => { stderr += part; }); const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("worker timeout")); }, 8000);
      child.on("error", (error) => { clearTimeout(timer); reject(error); }); child.on("exit", (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(stderr)); });
    })));
    const before = command(home, "read"); expect(before.active.map((entry) => entry.inputTokens).sort((a, b) => a! - b!)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const after = command(home, "accept", [event(1)]); expect(after.active).toHaveLength(7); expect(after.active.some((entry) => entry.inputTokens === 1)).toBe(false);
    command(home, "reject", [event(2)]);
    if (process.platform !== "win32") { expect(statSync(join(home, ".tokenizer")).mode & 0o777).toBe(0o700); for (const file of ["queue.jsonl", "rejected-usage.jsonl"]) expect(statSync(join(home, ".tokenizer", file)).mode & 0o777).toBe(0o600); }
    console.log("MULTIPROCESS_CONTROL", JSON.stringify({ beforeCount: before.active.length, afterAckCount: after.active.length }));
  } finally { rmSync(home, { recursive: true, force: true }); }
}, 20_000);
