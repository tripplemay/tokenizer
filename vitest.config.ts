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
    // Immutable evidence for the pre-R07 evaluator contract. Operational R07
    // intentionally supersedes its "dryRun:false is unsupported" assertion;
    // keep the original bytes hashable, but run the candidate-owned successor.
    exclude: [
      ...configDefaults.exclude,
      "tests/evaluator/b05-tcp-readiness-independent.test.ts",
      "tests/evaluator/b03-scope-admission-independent.test.ts"
    ],
    environment: "node"
  }
});
