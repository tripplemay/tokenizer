import { existsSync } from "node:fs";
import { mergeQueue } from "@/cli/collect";

const [queue, barrier, id] = process.argv.slice(2);
if (!queue || !barrier || !id) throw new Error("queue, barrier, and id are required");

while (!existsSync(barrier)) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
}

mergeQueue([{
  source: "claude-code",
  sourceEventId: id,
  occurredAt: "2026-10-07T12:00:00.000Z"
}], queue);
