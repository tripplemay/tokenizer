import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it.skipIf(process.platform === "win32")("bounded preview refuses stalled Git enrichment within its 10000 ms elapsed budget", () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "b03-git-elapsed-"));
  try {
    const bin = join(dir, "bin"); mkdirSync(bin);
    writeFileSync(join(bin, "git"), "#!/bin/sh\nprintf 'GIT_ENTERED\\n' >> \"$B03_GIT_MARKER\"\nsleep 12\nexit 1\n", { mode: 0o700 });
    const file = join(dir, "source.jsonl"); writeFileSync(file, JSON.stringify({ type: "assistant", uuid: "one", cwd: dir, timestamp: "2026-10-07T12:00:00.000Z", message: { role: "assistant", id: "one", usage: { input_tokens: 1 } } }) + "\n");
    const started = Date.now(); const child = spawnSync(process.execPath, ["--import", "tsx", join(process.cwd(), "tests/fixtures/b03-round2-git-timeout.ts"), file, dir], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, B03_GIT_MARKER: join(dir, "git-marker") }, timeout: 11_000, killSignal: "SIGKILL" });
    console.log("GIT_ELAPSED_NEGATIVE", JSON.stringify({ elapsedMs: Date.now() - started, errorCode: (child.error as NodeJS.ErrnoException | undefined)?.code, status: child.status, stdout: child.stdout }));
    expect(child.stdout).toContain("REPLAY_STARTED"); expect(child.error).toBeUndefined(); expect(child.status).toBe(0); expect(child.stdout).toContain("REPLAY_REFUSED");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 20_000);
