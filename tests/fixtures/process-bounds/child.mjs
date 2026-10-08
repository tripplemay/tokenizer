import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [mode, pidFile] = process.argv.slice(2);
if (pidFile) appendFileSync(pidFile, `${process.pid}\n`);
// Independent lifetime cap also protects failed/aborted test harnesses.
setTimeout(() => process.exit(91), 15_000).unref();

if (mode === "normal") {
  process.stdout.write(JSON.stringify({ argv: process.argv.slice(4), cwd: process.cwd(), home: process.env.HOME }));
  process.stderr.write("stderr-control");
} else if (mode === "nonzero") {
  process.stdout.write("ordinary-failure");
  process.exitCode = 23;
} else if (mode === "signal") {
  process.kill(process.pid, "SIGTERM");
} else if (mode === "combined") {
  process.stdout.write("a".repeat(600));
  process.stderr.write("b".repeat(600));
} else {
  process.on("SIGTERM", () => {});
  if (mode === "descendant" || mode === "inherited-pipes") {
    spawn(process.execPath, [fileURLToPath(import.meta.url), "resistant", pidFile], { stdio: "inherit" });
    if (mode === "inherited-pipes") setTimeout(() => process.exit(0), 200);
  }
  if (mode === "overflow") {
    process.stderr.write("RAW-STDERR-CANARY\n");
    setInterval(() => process.stdout.write(Buffer.alloc(4_096, 65)), 5);
  } else {
    setInterval(() => {}, 100);
  }
}
