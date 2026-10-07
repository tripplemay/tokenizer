import { spawn, execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sources = {
  round1: execFileSync("git", ["show", "e684bbd7b898fd982c5e505b8543d487920fa8ea:bin/tokenizer"], { encoding: "utf8" }),
  round2: readFileSync("bin/tokenizer", "utf8")
};

async function run(label, source) {
  const dir = mkdtempSync(join(tmpdir(), `tokenizer-wrapper-${label}-`));
  const root = join(dir, "app");
  const appBin = join(root, "bin");
  const fakeBin = join(dir, "fake-bin");
  const wrapper = join(appBin, "tokenizer");
  const fakeNode = join(fakeBin, "node");
  const childPidPath = join(dir, "child.pid");
  const preloadPath = join(dir, "preload.mjs");
  mkdirSync(appBin, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(wrapper, source); chmodSync(wrapper, 0o755);
  writeFileSync(fakeNode, "#!/bin/sh\ntrap 'exit 0' INT TERM HUP\nprintf '%s' \"$$\" > \"$TOKENIZER_TEST_CHILD_PID_FILE\"\nwhile :; do sleep 1; done\n");
  chmodSync(fakeNode, 0o755);
  writeFileSync(preloadPath, `
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const originalSpawn = childProcess.spawn;
childProcess.spawn = (...args) => {
  const child = originalSpawn(...args);
  const trigger = childProcess.spawnSync(process.execPath, ["-e", ${JSON.stringify(`
    const fs = require("node:fs");
    const deadline = Date.now() + 5000;
    function go() {
      const p = process.env.TOKENIZER_TEST_CHILD_PID_FILE;
      if (fs.existsSync(p) && /^\\d+$/.test(fs.readFileSync(p, "utf8"))) process.kill(Number(process.argv[1]), "SIGTERM");
      else if (Date.now() >= deadline) process.exitCode = 1;
      else setTimeout(go, 10);
    }
    go();
  `)}, String(process.pid)], { timeout: 6000 });
  if (trigger.status !== 0) throw new Error("trigger failed");
  return child;
};
syncBuiltinESMExports();
`);
  const started = Date.now();
  const processUnderTest = spawn(process.execPath, ["--import", preloadPath, wrapper], {
    cwd: root,
    env: { ...process.env, PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`, TOKENIZER_TEST_CHILD_PID_FILE: childPidPath },
    stdio: "ignore"
  });
  const exit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout`)), 10_000);
    processUnderTest.once("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
  for (let i = 0; i < 100 && !existsSync(childPidPath); i++) await sleep(10);
  const childPid = Number(readFileSync(childPidPath, "utf8"));
  let childAlive = true;
  try { process.kill(childPid, 0); } catch { childAlive = false; }
  if (childAlive) { try { process.kill(childPid, "SIGKILL"); } catch {} }
  rmSync(dir, { recursive: true, force: true });
  return { label, exit, childAliveAfterWrapperExit: childAlive, durationMs: Date.now() - started };
}

console.log(JSON.stringify([await run("round1", sources.round1), await run("round2", sources.round2)], null, 2));
