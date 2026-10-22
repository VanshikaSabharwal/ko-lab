import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ["./__tests__/setup.ts"],
    environment: "jsdom",
    globals: true,
    include: ["__tests__/**/*.test.{ts,tsx}"],
    // These need LocalStack running; they have their own config and command
    // (`npm run test:storage`).
    exclude: ["__tests__/storage/**", "**/node_modules/**"],
    alias: {
      "@": path.resolve(__dirname, "./app"),
    },
  },
});
