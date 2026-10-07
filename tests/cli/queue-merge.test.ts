import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acknowledgeQueuedEvents, mergeQueue } from "@/cli/collect";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const path = mkdtempSync(join(tmpdir(), "tokenizer-queue-merge-"));
  roots.push(path);
  return path;
}

function waitForWorker(queue: string, barrier: string, id: string): Promise<void> {
  const worker = join(process.cwd(), "tests", "fixtures", "merge-queue-worker.ts");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", worker, queue, barrier, id], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`worker ${id} failed (${code}): ${stderr}`)));
  });
}

describe("durable queue merge", () => {
  it("serializes concurrent replay/collection writers without losing retained backlog", async () => {
    const dir = root();
    const queue = join(dir, "queue.jsonl");
    const barrier = join(dir, "start");
    writeFileSync(queue, JSON.stringify({
      source: "claude-code",
      sourceEventId: "retained",
      occurredAt: "2026-10-01T00:00:00.000Z"
    }) + "\n");
    const workers = Array.from({ length: 6 }, (_, index) => waitForWorker(queue, barrier, `concurrent-${index}`));
    writeFileSync(barrier, "go");
    await Promise.all(workers);

    const events = readFileSync(queue, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(new Set(events.map((event) => event.sourceEventId))).toEqual(new Set([
      "retained",
      ...Array.from({ length: 6 }, (_, index) => `concurrent-${index}`)
    ]));
  }, 20_000);

  it("fails closed on a corrupt queue instead of overwriting old bytes", () => {
    const dir = root();
    const queue = join(dir, "queue.jsonl");
    writeFileSync(queue, "not-json\n");

    expect(() => mergeQueue([{
      source: "claude-code",
      sourceEventId: "new",
      occurredAt: "2026-10-07T12:00:00.000Z"
    }], queue)).toThrow();
    expect(readFileSync(queue, "utf8")).toBe("not-json\n");
  });

  it("acknowledges only sent bytes and preserves concurrent additions or corrections", () => {
    const dir = root();
    const queue = join(dir, "queue.jsonl");
    const sent = {
      source: "claude-code" as const,
      sourceEventId: "sent",
      occurredAt: "2026-10-07T10:00:00.000Z",
      totalTokens: 10
    };
    mergeQueue([sent], queue);
    mergeQueue([{
      source: "claude-code",
      sourceEventId: "concurrent-replay",
      occurredAt: "2026-10-07T11:00:00.000Z"
    }, { ...sent, totalTokens: 12 }], queue);

    const remaining = acknowledgeQueuedEvents([sent], queue);
    expect(remaining.map((event) => [event.sourceEventId, event.totalTokens])).toEqual([
      ["sent", 12],
      ["concurrent-replay", undefined]
    ]);
  });
});
