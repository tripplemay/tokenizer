import { dryRunBoundedReplay } from "../../src/cli/replay";
import { planBoundedReplay } from "../../src/cli/replay-contract";

console.log("REPLAY_STARTED");
try {
  const result = dryRunBoundedReplay(planBoundedReplay({
    source: "claude-code",
    file: process.argv[2],
    from: "2026-10-07T00:00:00.000Z",
    to: "2026-10-08T00:00:00.000Z",
    maxBytes: 100_000,
    maxEvents: 10
  }), {
    serverUrl: "http://127.0.0.1:9",
    projectRoots: [],
    sources: { claude: true, codex: false, opencode: false, aider: false, kimicode: false },
    privacy: { mode: "local-only", includePaths: [process.argv[3]], excludePaths: [] }
  });
  console.log("REPLAY_COMPLETED", JSON.stringify(result));
} catch (error) {
  console.log("REPLAY_REFUSED", error instanceof Error ? error.message : String(error));
}
