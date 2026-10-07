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
    // Immutable B06 server-slice evidence: this test locks the deliberately
    // obsolete behavior where a permanent 400 retries three times and pins
    // every good neighbour. The replacement regression exercises partial ACK,
    // durable quarantine and the previous-server compatibility path.
    exclude: [
      "tests/cli/b06-batch-failure-queue.test.ts",
      "tests/cli/b06-partial-ack.test.ts",
      "tests/ci/b06-obsolete-queue-test-archive.test.ts"
    ],
    environment: "node"
  }
});
