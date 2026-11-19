import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "node",
    // The 20,000-row timing probe runs only through `npm run test:scale`.
    include: process.env.SCALE ? ["tests/perf/**/*.test.ts"] : ["tests/unit/**/*.test.ts", "tests/session/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
