import { readFileSync } from "node:fs";

if (process.platform !== "win32") {
  throw new Error("Windows agent owner acceptance requires a native Windows runner");
}

const [path] = process.argv.slice(2);
if (!path) throw new Error("Usage: node assert-windows-agent-owner.mjs <report.json>");

const result = JSON.parse(readFileSync(path, "utf8"));
const name = "agent single-instance lock reclaims a lock after Windows force-terminates the agent";
const cases = (result.testResults ?? []).flatMap((file) => file.assertionResults ?? [])
  .filter((test) => test.fullName === name);

if (result.success !== true || result.numFailedTests !== 0 || result.numPassedTests !== 1 || cases.length !== 1 || cases[0].status !== "passed") {
  throw new Error("Expected the exact Windows force-termination owner test to pass once, not skip or disappear");
}

console.log("Verified native Windows direct-owner force termination and stale-lock recovery");
