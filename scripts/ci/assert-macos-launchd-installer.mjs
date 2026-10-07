import { readFileSync } from "node:fs";

if (process.platform !== "darwin") throw new Error("launchd installer acceptance requires a native macOS runner");
const [path] = process.argv.slice(2);
if (!path) throw new Error("Usage: node assert-macos-launchd-installer.mjs <report.json>");
const report = JSON.parse(readFileSync(path, "utf8"));
const name = "native macOS launchd pinned installer fixture installs and upgrades a live isolated service, restores it after failure, and rolls back offline without touching the default label";
const cases = (report.testResults ?? []).flatMap((file) => file.assertionResults ?? [])
  .filter((test) => test.fullName === name);
if (report.success !== true || report.numFailedTests !== 0 || report.numPassedTests !== 1 || cases.length !== 1 || cases[0].status !== "passed") {
  throw new Error("Expected the exact native macOS launchd installer fixture to pass once, not skip or disappear");
}
console.log("Verified native macOS launchd install, upgrade, failure restore, offline rollback and isolated cleanup fixture");
