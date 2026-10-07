import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const forbidden = new Set([
  "docs", "tests", "src", "app", "scripts", ".git", ".baseline", ".releases",
  ".auto-memory", ".claude", "framework", "CLAUDE.md", "AGENTS.md",
  "progress.json", "features.json", "backlog.json", "harness.json", "harness.lock"
]);
// Next 15 traces these imported runtime catalogs; Next 16 inlines them.
const runtimeCatalogs = new Set(["src/shared/agent-releases.json", "framework/harness/framework-releases.json"]);

export function verifyStandalone(root) {
  if (!existsSync(join(root, "server.js"))) throw new Error("standalone server missing");
  const migrations = join(root, "prisma", "migrations");
  if (!existsSync(migrations) || !readdirSync(migrations).some((name) => /^20\d{12}_/.test(name))) {
    throw new Error("standalone migration markers missing");
  }
  let files = 0;
  let bytes = 0;
  const runtimeRoots = new Set([".next", "node_modules", "prisma", "public", "package.json", "server.js"]);
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      const path = join(dir, entry.name);
      const artifact = relative(root, path).replaceAll("\\", "/");
      const catalogTree = /^(src|framework)(\/|$)/.test(artifact);
      const catalogPath = runtimeCatalogs.has(artifact) || (entry.isDirectory() && [...runtimeCatalogs].some((file) => file.startsWith(`${artifact}/`)));
      if ((catalogTree ? !catalogPath : ((dir === root && !runtimeRoots.has(entry.name)) || forbidden.has(entry.name))) || entry.name.startsWith(".env") || entry.isSymbolicLink()) {
        throw new Error(`unrelated standalone artifact: ${relative(root, path)}`);
      }
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) { files++; bytes += statSync(path).size; }
    }
  }
  visit(root);
  return { filesOutsideDependenciesAndNext: files, bytesOutsideDependenciesAndNext: bytes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify({ standalone: "clean", ...verifyStandalone(resolve(process.argv[2] ?? ".next/standalone")) }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "standalone artifact verification failed");
    process.exitCode = 1;
  }
}
