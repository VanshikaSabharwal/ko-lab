import { defineConfig } from "vitest/config";
import path from "path";

// Storage tests: the app's real upload/download code against LocalStack.
// Separate from the main suite (`npm test`) because they need LocalStack
// running. Run with `npm run test:storage`.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["__tests__/storage/**/*.test.ts"],
    globalSetup: ["./__tests__/storage/globalSetup.ts"],
    setupFiles: ["./__tests__/storage/env.ts"],
    // The files share two buckets; one at a time keeps listings predictable
    fileParallelism: false,
    testTimeout: 20_000,
    alias: {
      "@": path.resolve(__dirname, "./app"),
    },
  },
});
