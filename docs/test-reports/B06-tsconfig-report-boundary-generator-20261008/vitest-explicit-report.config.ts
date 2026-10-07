import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../../src", import.meta.url))
    }
  },
  test: {
    include: ["docs/test-reports/B06-kimi-evaluator-20261008/independent-adversarial.test.ts"],
    environment: "node"
  }
});
