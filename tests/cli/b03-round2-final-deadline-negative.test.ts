import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import * as git from "@/cli/git";
import { dryRunBoundedReplay, executeBoundedReplay } from "@/cli/replay";
import { planBoundedReplay } from "@/cli/replay-contract";

it("final admission must refuse when its wall clock advances beyond budget during otherwise unchanged enrichment", () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "b03-final-deadline-"));
  try {
    const file = join(dir, "source.jsonl"); writeFileSync(file, JSON.stringify({ type: "assistant", uuid: "one", cwd: dir, timestamp: "2026-10-07T12:00:00.000Z", message: { role: "assistant", id: "one", usage: { input_tokens: 1 } } }) + "\n");
    const request = { source: "claude-code", file, from: "2026-10-07T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z", maxBytes: 100_000, maxEvents: 10 };
    const config = { serverUrl: "http://127.0.0.1:9", projectRoots: [], sources: { claude: true, codex: false, opencode: false, aider: false, kimicode: false }, privacy: { mode: "local-only" as const, includePaths: [dir], excludePaths: [] } };
    let clock = Date.now(); let calls = 0; vi.spyOn(Date, "now").mockImplementation(() => clock);
    vi.spyOn(git, "enrichEventsWithGit").mockImplementation((events) => { calls += 1; if (calls === 2) clock += 11_000; return events; });
    const preview = dryRunBoundedReplay(planBoundedReplay(request), config); calls = 0;
    const merge = vi.fn((events) => ({ events, added: events.length })); let observed: unknown;
    expect(() => { observed = executeBoundedReplay(planBoundedReplay({ ...request, dryRun: false }), config, preview.planDigest, { readCurrentConfig: () => config, mergeEvents: merge }); console.log("FINAL_CLOCK_NEGATIVE", JSON.stringify({ simulatedAdvanceMs: 11000, calls, result: observed, mergeCalled: merge.mock.calls.length })); }).toThrow(/exceeded|deadline|timeout/i);
  } finally { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }); }
});
