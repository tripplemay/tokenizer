import { afterEach, expect, it, vi } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeGitShim } from "./fixtures";

let root: string | undefined;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

it.skipIf(process.platform !== "win32")("fails closed on a native overflowing reparse checker without raw stderr", async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "pbw-")));
  const home = join(root, "home");
  mkdirSync(home);
  const env = makeGitShim(root, { ...process.env, HOME: home, USERPROFILE: home, TMPDIR: root });
  copyFileSync(join(root, "bin", "git.exe"), join(root, "bin", "powershell.exe"));
  for (const [key, value] of Object.entries({ ...env, PB_GIT_MODE: "overflow" })) {
    if (value !== undefined) vi.stubEnv(key, value);
  }
  const file = join(root, "source.jsonl");
  writeFileSync(file, "{}\n");
  const { readBoundedReplayFile } = await import("../../../src/cli/replay");
  expect(() => readBoundedReplayFile(file, 1_024)).toThrow("Replay refused: source could not be opened safely");
}, 15_000);
