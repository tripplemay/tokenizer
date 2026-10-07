const fs = require("node:fs");
const path = require("node:path");

// Native Node fixture only: exit before importing tsx or executing a real CLI.
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/src/cli/index.ts")) {
  const command = process.argv[2];
  const exitCode = command === "configure" && process.env.TEST_CONFIGURE_FAIL === "1" ? 42
    : command === "enroll" && process.env.TEST_ENROLL_FAIL === "1" ? 55 : 0;
  const revisionFile = path.join(process.cwd(), "revision");
  fs.appendFileSync(process.env.TEST_CLI_TRACE, JSON.stringify({
    command, exitCode, revision: fs.existsSync(revisionFile) ? fs.readFileSync(revisionFile, "utf8") : null
  }) + "\n");
  if (exitCode === 55) {
    const token = process.argv[process.argv.indexOf("--enroll-token") + 1];
    console.log(token);
    console.error(token);
  }
  process.exit(exitCode);
}
