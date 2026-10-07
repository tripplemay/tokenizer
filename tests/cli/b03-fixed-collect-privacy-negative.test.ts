import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it.each(["dot", "git-symlink"] as const)("normal CLI collect independently rejects excluded workspace via %s", (kind) => {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "b03-collect-negative-"));
  try {
    const allowed = join(home, "allowed"); const denied = join(home, "denied"); mkdirSync(denied);
    if (kind === "dot") mkdirSync(allowed);
    else { execFileSync("git", ["init", "--quiet", denied]); symlinkSync(denied, allowed, "dir"); }
    const cwd = kind === "dot" ? `${allowed}/../denied` : allowed;
    const tokenizer = join(home, ".tokenizer"); const sourceDir = join(home, ".claude", "projects", "fixture"); mkdirSync(tokenizer); mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(tokenizer, "config.json"), JSON.stringify({ serverUrl: "http://127.0.0.1:9", projectRoots: [], sources: { claude: true, codex: false, opencode: false, aider: false, kimicode: false }, privacy: { mode: "local-only", includePaths: [allowed], excludePaths: [denied] } }));
    writeFileSync(join(sourceDir, "source.jsonl"), JSON.stringify({ type: "assistant", uuid: kind, cwd, timestamp: "2026-10-07T12:00:00.000Z", message: { role: "assistant", id: kind, model: "fixture", usage: { input_tokens: 1, output_tokens: 2 } } }) + "\n");
    const child = spawnSync(process.execPath, ["--import", "tsx", join(process.cwd(), "src/cli/index.ts"), "collect"], { encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home }, timeout: 5000 });
    expect(child.error).toBeUndefined(); expect(child.status, child.stderr).toBe(0);
    const queue = readFileSync(join(tokenizer, "queue.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    console.log("NORMAL_COLLECT_NEGATIVE", JSON.stringify({ kind, stdout: child.stdout, queue }));
    expect(queue).toHaveLength(0);
  } finally { rmSync(home, { recursive: true, force: true }); }
}, 10_000);
