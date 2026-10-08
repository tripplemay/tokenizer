import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { request, config, queue, mode, confirmation } = JSON.parse(readFileSync(process.env.PB_REPLAY_MANIFEST, "utf8"));
if (queue !== join(process.env.HOME, ".tokenizer", "queue.jsonl") || process.env.HOME !== process.env.USERPROFILE) {
  throw new Error("fixture requires an explicit synthetic queue and isolated home before import");
}
const root = process.env.PB_PRODUCT_ROOT;
const { queuePath } = await import(pathToFileURL(join(root, "src/cli/config.ts")).href);
if (queuePath !== queue) throw new Error("unexpected fixture queue path");
const { dryRunBoundedReplay, executeBoundedReplay } = await import(pathToFileURL(join(root, "src/cli/replay.ts")).href);
const { planBoundedReplay } = await import(pathToFileURL(join(root, "src/cli/replay-contract.ts")).href);
let lockSeen = false;
const now = Date.now;
if (mode === "late-lock") {
  Date.now = () => {
    if (existsSync(`${queue}.lock`)) { lockSeen = true; return now() + 11_000; }
    return now();
  };
}
const started = now();
try {
  const result = mode === "preview"
    ? dryRunBoundedReplay(planBoundedReplay(request), config)
    : executeBoundedReplay(planBoundedReplay({ ...request, dryRun: false }), config, confirmation, { readCurrentConfig: () => config });
  console.log(JSON.stringify({ result, elapsedMs: now() - started, lockSeen }));
} catch (error) {
  console.log(JSON.stringify({ error: error.message, elapsedMs: now() - started, lockSeen }));
} finally {
  Date.now = now;
}
