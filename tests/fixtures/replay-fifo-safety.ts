import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { readBoundedReplayFile } from "../../src/cli/replay";

try {
  readBoundedReplayFile(process.argv[2], 1024 * 1024, {
    afterPathStat: () => {
      rmSync(process.argv[2]);
      execFileSync("mkfifo", [process.argv[2]]);
      console.log("FIFO_CREATED");
    }
  });
  throw new Error("FIFO must never be accepted");
} catch (error) {
  if (!(error instanceof Error) || !error.message.startsWith("Replay refused:")) throw error;
  console.log("SAFE_REFUSAL", error.message);
}
