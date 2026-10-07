import { readFileSync } from "node:fs";

if (process.platform !== "win32") throw new Error("Installer acceptance requires a native Windows runner");
const [path] = process.argv.slice(2);
if (!path) throw new Error("Usage: node assert-windows-installer.mjs <report.json>");
const report = JSON.parse(readFileSync(path, "utf8"));
const name = "native Windows pinned installer fixture installs, rejects failures and concurrency, then rolls back offline without leaking enrollment tokens";
const cases = (report.testResults ?? []).flatMap((file) => file.assertionResults ?? [])
  .filter((test) => test.fullName === name);
if (report.success !== true || report.numFailedTests !== 0 || report.numPassedTests !== 1 || cases.length !== 1 || cases[0].status !== "passed") {
  throw new Error("Expected the exact native Windows installer fixture to pass once, not skip or disappear");
}
console.log("Verified native Windows installer failure, restore, lock and offline rollback fixture");
