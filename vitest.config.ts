import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Immutable evidence for the pre-R07 evaluator contract. Operational R07
    // intentionally supersedes its "dryRun:false is unsupported" assertion;
    // keep the original bytes hashable, but run the candidate-owned successor.
    exclude: ["tests/evaluator/b03-scope-admission-independent.test.ts"],
    environment: "node"
  }
});
