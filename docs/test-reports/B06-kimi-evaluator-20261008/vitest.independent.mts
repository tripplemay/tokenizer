import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Independent Kimi evaluator config: runs ONLY the probes in this report
// directory against the worktree's real sources. Keeps every evaluator
// artifact inside docs/test-reports/B06-kimi-evaluator-20261008/.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../../src", import.meta.url))
    }
  },
  test: {
    include: [fileURLToPath(new URL("independent-*.test.ts", import.meta.url))],
    environment: "node",
    testTimeout: 30_000
  }
});
