// Kimi F005 independent adversarial child fixture. Distinct from Generator's
// child.mjs: different modes, different canary strings, own 12s lifetime cap.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [mode, pidFile] = process.argv.slice(2);
if (pidFile) appendFileSync(pidFile, `${process.pid}\n`);
setTimeout(() => process.exit(93), 12_000).unref();

if (mode === "normal") {
  process.stdout.write(JSON.stringify({ argv: process.argv.slice(4), cwd: process.cwd(), home: process.env.HOME }));
  process.stderr.write("ev-stderr-ok");
} else if (mode === "nonzero") {
  process.stdout.write("ev-ordinary-failure");
  process.exitCode = 17;
} else if (mode === "sigterm-self") {
  process.kill(process.pid, "SIGTERM");
} else if (mode === "resist") {
  // Ignores SIGTERM; only SIGKILL (or group kill) can reap it.
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 100);
} else if (mode === "resist-tree") {
  // SIGTERM-resistant parent that spawns a SIGTERM-resistant descendant with
  // INHERITED pipes, then the parent exits early — leaving the descendant
  // holding the stdout/stderr pipes open (classic close-hang vector).
  process.on("SIGTERM", () => {});
  spawn(process.execPath, [fileURLToPath(import.meta.url), "resist", pidFile], { stdio: "inherit" });
  setTimeout(() => process.exit(0), 250);
} else if (mode === "overflow") {
  process.stderr.write("EV-RAW-STDERR-CANARY-KIMI\n");
  setInterval(() => process.stdout.write(Buffer.alloc(8_192, 66)), 2);
} else if (mode === "mixed-budget") {
  process.stdout.write("x".repeat(700));
  process.stderr.write("y".repeat(700));
}
