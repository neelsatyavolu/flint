import { defineConfig } from "vitest/config";
// The GreenMail suites start a Java mail server and wait for a first sync inside beforeAll; under the parallel
// `pnpm -r test` of a release that takes longer than vitest's 10 s default hook limit.
export default defineConfig({ test: { include: ["src/**/*.test.ts", "test/**/*.test.ts"], hookTimeout: 60_000, coverage: { provider: "v8", include: ["src/**"], exclude: ["src/**/*.test.ts"] } } });
