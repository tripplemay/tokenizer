// Scratch debug: replicate probe-f003 control order, print enrichment for a
// fresh real repo at the end. Not a verdict control.
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.env.EV_ROOT;
const REPO = process.env.EV_REPO;
const REAL_GIT = process.env.EV_REAL_GIT;
const bin = join(ROOT, "bin");
mkdirSync(bin, { recursive: true });
const shimSource = join(REPO, "docs/test-reports/BL-REPLAY-PROCESS-BOUNDS-kimi-20261008/probes/ev-git-shim.mjs");
const shim = join(bin, "git");
copyFileSync(shimSource, shim);
writeFileSync(shim, `#!${process.execPath}\n${readFileSync(shim, "utf8")}`);
chmodSync(shim, 0o755);
const pidFile = join(ROOT, "pids");
const basePath = process.env.PATH;
const shimOn = (mode) => { process.env.PATH = `${bin}:${basePath}`; process.env.EV_GIT_MODE = mode; process.env.EV_PID_FILE = pidFile; process.env.EV_REAL_GIT = REAL_GIT; };
const shimOff = () => { process.env.PATH = basePath; delete process.env.EV_GIT_MODE; delete process.env.EV_DESCENDANT; };

const { enrichEventsWithGit } = await import(pathToFileURL(join(REPO, "src/cli/git.ts")).href);
const enrich = (ws) => enrichEventsWithGit([{ workspacePath: ws }], { deadlineMs: Date.now() + 10_000 })[0];

const ws1 = join(ROOT, "ws1"); mkdirSync(ws1);
const ws2 = join(ROOT, "ws2"); mkdirSync(ws2);
const ws3 = join(ROOT, "ws3"); mkdirSync(ws3);
const ws4 = join(ROOT, "ws4"); mkdirSync(ws4);
const ws5 = join(ROOT, "ws5"); mkdirSync(ws5);
execFileSync(REAL_GIT, ["init", "-q"], { cwd: ws3 });
execFileSync(REAL_GIT, ["-c", "user.name=Ev", "-c", "user.email=ev@example.invalid", "commit", "--allow-empty", "-qm", "ev"], { cwd: ws3 });
execFileSync(REAL_GIT, ["init", "-q"], { cwd: ws5 });
execFileSync(REAL_GIT, ["-c", "user.name=Ev", "-c", "user.email=ev@example.invalid", "commit", "--allow-empty", "-qm", "ev"], { cwd: ws5 });
execFileSync(REAL_GIT, ["remote", "add", "origin", "https://evuser:EV-PRIVATE-TOKEN-KIMI@git.example/team/ev-fixture.git"], { cwd: ws5 });

shimOff();
console.log("ws1 (non-repo):", JSON.stringify(enrich(ws1)));
shimOn("stall");
try { enrich(ws2); } catch (e) { console.log("ws2 stall threw:", e.constructor.name); }
shimOff();
shimOn("delay"); process.env.EV_GIT_DELAY_MS = "2500";
try { enrich(ws3); } catch (e) { console.log("ws3 delay threw:", e.constructor.name); }
shimOff(); delete process.env.EV_GIT_DELAY_MS;
shimOn("overflow");
try { enrich(ws4); } catch (e) { console.log("ws4 overflow threw:", e.constructor.name); }
shimOff();
console.log("ws5 (real repo):", JSON.stringify(enrich(ws5)));
