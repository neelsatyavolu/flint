import { defineConfig } from "vitest/config";
// Several tests spawn the built CLI as a separate process; under the parallel `pnpm -r test` of a release, process
// startup alone can pass vitest's 5 s default.
export default defineConfig({ test: { include: ["src/**/*.test.ts", "test/**/*.test.ts"], testTimeout: 20_000, coverage: { provider: "v8", include: ["src/**"], exclude: ["src/**/*.test.ts"] } } });
