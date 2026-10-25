import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  test: { include: ["*.test.mts", "*.test.ts"], testTimeout: 180_000, hookTimeout: 60_000, fileParallelism: false, environment: "node" },
});
