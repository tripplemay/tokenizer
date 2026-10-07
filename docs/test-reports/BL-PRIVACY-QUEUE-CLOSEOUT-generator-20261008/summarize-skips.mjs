import { readFileSync } from "node:fs";
import { relative } from "node:path";

const directory = "docs/test-reports/BL-PRIVACY-QUEUE-CLOSEOUT-generator-20261008";
const report = JSON.parse(readFileSync(`${directory}/short-root-full-controlled.json`, "utf8"));
const records = [];
for (const file of report.testResults) {
  const path = relative(process.cwd(), file.name);
  const skipped = file.assertionResults.filter((test) => ["pending", "skipped", "todo"].includes(test.status));
  if (!skipped.length) continue;
  const source = readFileSync(path, "utf8");
  const env = [...new Set([...source.matchAll(/process\.env\.(EVAL_[A-Z0-9_]*DB[A-Z0-9_]*|CONTRACT_FIXTURES_DIR)/g)].map((match) => match[1]))];
  const category = env.includes("CONTRACT_FIXTURES_DIR") ? "external-contract-fixtures" : env.length ? "scratch-database" : "native-windows";
  records.push({
    path, category,
    reason: env.length ? `${env.join(", ")} not configured in the synthetic local runner` : "Native Windows cases skipped on darwin",
    tests: skipped.map((test) => ({ title: test.fullName, status: test.status }))
  });
}
const total = records.reduce((sum, record) => sum + record.tests.length, 0);
if (total !== 31) throw new Error(`Unexpected skip count: ${total}`);
console.log(JSON.stringify({ report: "short-root-full-controlled.json", total, records }, null, 2));
