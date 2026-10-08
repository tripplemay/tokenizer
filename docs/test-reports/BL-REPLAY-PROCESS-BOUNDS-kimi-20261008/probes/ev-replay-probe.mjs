// Kimi F005 child runner: one replay invocation per fresh process (mirrors
// real CLI usage and avoids git.ts per-process workspace cache). Manifest:
// { request, config, queue, mode: "preview"|"execute", confirmation }.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const manifest = JSON.parse(readFileSync(process.env.EV_REPLAY_MANIFEST, "utf8"));
const { request, config, queue, mode, confirmation } = manifest;
const HOME_DIR = process.env.HOME;
if (!HOME_DIR?.startsWith("/private/tmp/tk-ev") || HOME_DIR !== process.env.USERPROFILE ||
    queue !== join(HOME_DIR, ".tokenizer", "queue.jsonl")) {
  throw new Error("fixture requires synthetic HOME and explicit synthetic queue before imports");
}
const REPO = process.env.EV_REPO;
const { queuePath } = await import(pathToFileURL(join(REPO, "src/cli/config.ts")).href);
if (queuePath !== queue) throw new Error(`queue mismatch: ${queuePath}`);
const { dryRunBoundedReplay, executeBoundedReplay } = await import(pathToFileURL(join(REPO, "src/cli/replay.ts")).href);
const { planBoundedReplay } = await import(pathToFileURL(join(REPO, "src/cli/replay-contract.ts")).href);
const started = Date.now();
try {
  const result = mode === "preview"
    ? dryRunBoundedReplay(planBoundedReplay(request), config)
    : executeBoundedReplay(planBoundedReplay({ ...request, dryRun: false }), config, confirmation, { readCurrentConfig: () => config });
  console.log(JSON.stringify({ result, elapsedMs: Date.now() - started }));
} catch (error) {
  console.log(JSON.stringify({ error: error.message, elapsedMs: Date.now() - started }));
}
