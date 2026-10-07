import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
  let shimEnv: Record<string, string> = {};
  if (process.platform === "win32") {
    const preload = join(bin, "git-version-preload.cjs");
    copyFileSync(process.execPath, join(bin, "git.exe"));
    writeFileSync(preload, [
      "const { appendFileSync } = require('node:fs');",
      "const { basename } = require('node:path');",
      "if (basename(process.execPath).toLowerCase() === 'git.exe') {",
      "  appendFileSync(process.env.AGENT_VERSION_MARKER, 'called\\n');",
      "  process.stdout.write('abcdef123456\\n');",
      "  process.exit(0);",
      "}"
    ].join("\n"));
    shimEnv = { NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require \"${preload}\"`.trim() };
  } else {
    writeFileSync(join(bin, "git"), "#!/bin/sh\nprintf 'called\\n' >> \"$AGENT_VERSION_MARKER\"\nprintf 'abcdef123456\\n'\n", { mode: 0o700 });
  }
  const moduleUrl = new URL("../../src/cli/agent-version.ts", import.meta.url).href;
  const child = spawnSync(process.execPath, [
    "--import", "tsx", "--input-type=module", "-e",
    `const m = await import(${JSON.stringify(moduleUrl)}); console.log(m.getAgentVersion()); console.log(m.getAgentVersion());`
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...shimEnv,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      AGENT_VERSION_MARKER: marker
    }
  });

  expect(child.status, child.stderr).toBe(0);
  expect(child.stdout.trim().split(/\r?\n/)).toEqual(["abcdef123456", "abcdef123456"]);
  expect(readFileSync(marker, "utf8").match(/called/g)).toHaveLength(1);
});
