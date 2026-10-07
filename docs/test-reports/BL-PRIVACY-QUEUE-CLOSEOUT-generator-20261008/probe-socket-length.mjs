import { mkdtempSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

if (process.platform !== "darwin") throw new Error("This is a local macOS socket-length probe");
const root = mkdtempSync(join(realpathSync("/tmp"), "tk-socket-"));
async function pair(directory) {
  mkdirSync(directory, { recursive: true });
  const paths = [join(directory, "shared-prefix-one.sock"), join(directory, "shared-prefix-two.sock")];
  const servers = paths.map(() => createServer());
  const outcomes = [];
  try {
    for (const [index, path] of paths.entries()) {
      outcomes.push(await new Promise((resolve) => {
        servers[index].once("error", (error) => resolve({ listening: false, code: error.code }));
        servers[index].listen(path, () => resolve({ listening: true, code: null }));
      }));
    }
    return { paths, bytes: paths.map((path) => Buffer.byteLength(path)), outcomes, actualNames: readdirSync(directory) };
  } finally {
    for (const server of servers) {
      if (server.listening) await new Promise((resolve) => server.close(resolve));
    }
  }
}
try {
  console.log(JSON.stringify({
    platform: process.platform, node: process.version,
    short: await pair(join(root, "short")),
    long: await pair(join(root, "x".repeat(64)))
  }, null, 2));
} finally { rmSync(root, { recursive: true, force: true }); }
