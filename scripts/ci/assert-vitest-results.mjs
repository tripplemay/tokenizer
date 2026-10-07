import { readFileSync } from "node:fs";

const [path, minimumArg] = process.argv.slice(2);
const minimum = Number(minimumArg);

if (!path || !Number.isSafeInteger(minimum) || minimum < 1) {
  throw new Error("Usage: node assert-vitest-results.mjs <report.json> <minimum-tests>");
}

const result = JSON.parse(readFileSync(path, "utf8"));
const { numTotalTests, numPassedTests, numPendingTests, numFailedTests } = result;

if (
  !Number.isSafeInteger(numTotalTests) ||
  numTotalTests < minimum ||
  numPassedTests !== numTotalTests ||
  numPendingTests !== 0 ||
  numFailedTests !== 0
) {
  throw new Error(
    `Expected at least ${minimum} passing tests with no skips or failures; ` +
    `got total=${numTotalTests}, passed=${numPassedTests}, skipped=${numPendingTests}, failed=${numFailedTests}`
  );
}

console.log(`Verified ${numPassedTests} tests with no skips or failures`);
