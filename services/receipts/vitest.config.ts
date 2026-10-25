import { defineConfig } from "vitest/config";

// @cloudflare/vitest-pool-workers 0.23 pins vitest 4.1 and the workspace uses vitest 5,
// so tests run in plain Node against a node:sqlite-backed D1 fake (src/test/fakeD1.ts).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: { provider: "v8", include: ["src/**"], exclude: ["src/**/*.test.ts", "src/test/**", "src/apple-ranges.ts"] },
  },
});
