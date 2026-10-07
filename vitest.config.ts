import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Immutable historical audit uses local-only git objects and asserts a
    // former defect. Its portable replacement is b05-recovery-source.test.ts.
    exclude: [...configDefaults.exclude, "tests/evaluator/b05-tcp-readiness-independent.test.ts"],
    environment: "node"
  }
});
