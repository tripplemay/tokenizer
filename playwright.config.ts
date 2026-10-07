import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.CI_E2E_BASE_URL ?? "http://127.0.0.1:3781";
const databaseURL = process.env.DATABASE_URL;
const app = new URL(baseURL);

if (app.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(app.hostname)) {
  throw new Error("Browser tests require a local HTTP application URL");
}

if (process.env.CI_E2E !== "1" || !databaseURL || databaseURL !== process.env.E2E_DATABASE_URL) {
  throw new Error("Browser tests require CI_E2E=1 and matching scratch DATABASE_URL/E2E_DATABASE_URL");
}
const database = new URL(databaseURL);
if (
  database.protocol !== "postgresql:" ||
  !["localhost", "127.0.0.1"].includes(database.hostname) ||
  !/^tokenizer_e2e(?:_|$)/.test(database.pathname.slice(1))
) {
  throw new Error("Browser tests refuse non-local or non-E2E PostgreSQL databases");
}

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 150_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["junit", { outputFile: "test-results/e2e/results.xml" }]],
  outputDir: "test-results/e2e/artifacts",
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  webServer: process.env.CI_E2E_EXTERNAL_SERVER === "1" ? undefined : {
    command: `npm run start -- -p ${app.port || "80"} -H 127.0.0.1`,
    url: `${baseURL}/login`,
    timeout: 90_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe"
  }
});
