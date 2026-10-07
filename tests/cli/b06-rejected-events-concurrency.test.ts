import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRejectedUsageEvents } from "@/cli/rejected-events";

const path = join(tmpdir(), `b06-rejected-concurrency-${process.pid}.jsonl`);
const tsx = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const script = [
  'import { quarantineUsageEvents } from "./src/cli/rejected-events.ts";',
  'quarantineUsageEvents([{ event: { source: "aider", sourceEventId: process.argv[2], occurredAt: "2026-10-08T00:00:00.000Z" }, code: "invalid_event" }], process.argv[1]);'
].join(" ");

function writer(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsx, "-e", script, path, id], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`writer ${id} exit ${code}: ${stderr}`)));
  });
}

describe("B06 rejected usage concurrency", () => {
  afterEach(() => {
    rmSync(path, { force: true });
    rmSync(`${path}.lock`, { force: true });
  });

  it("serializes two native processes without losing either rejected event", async () => {
    await Promise.all([writer("row-a"), writer("row-b")]);
    expect(readRejectedUsageEvents(path).map((row) => row.event.sourceEventId).sort())
      .toEqual(["row-a", "row-b"]);
  });
});
