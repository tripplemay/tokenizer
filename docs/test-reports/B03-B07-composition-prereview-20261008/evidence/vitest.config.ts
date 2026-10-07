import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../../../../src", import.meta.url)) } },
  test: { include: ["docs/test-reports/B03-B07-composition-prereview-20261008/evidence/*.test.ts"] }
});
