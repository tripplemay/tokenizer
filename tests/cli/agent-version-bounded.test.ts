import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, expect, it } from "vitest";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("captures the Agent SHA once at module load and keeps it frozen", () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "agent-version-bound-"));
  roots.push(root);
  const bin = join(root, "bin");
  const marker = join(root, "calls");
  mkdirSync(bin);
  const gitShim = process.platform === "win32" ? join(bin, "git.cmd") : join(bin, "git");
  const shim = process.platform === "win32"
    ? "@echo off\r\necho called>>\"%AGENT_VERSION_MARKER%\"\r\necho abcdef123456\r\n"
    : "#!/bin/sh\nprintf 'called\\n' >> \"$AGENT_VERSION_MARKER\"\nprintf 'abcdef123456\\n'\n";
  writeFileSync(gitShim, shim, { mode: 0o700 });
  const moduleUrl = new URL("../../src/cli/agent-version.ts", import.meta.url).href;
  const child = spawnSync(process.execPath, [
    "--import", "tsx", "--input-type=module", "-e",
    `const m = await import(${JSON.stringify(moduleUrl)}); console.log(m.getAgentVersion()); console.log(m.getAgentVersion());`
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      AGENT_VERSION_MARKER: marker
    }
  });

  expect(child.status, child.stderr).toBe(0);
  expect(child.stdout.trim().split(/\r?\n/)).toEqual(["abcdef123456", "abcdef123456"]);
  expect(readFileSync(marker, "utf8").match(/called/g)).toHaveLength(1);
});
