import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = {
  "@flint/core/api": resolve(import.meta.dirname, "../../packages/core/src/api.ts"),
  "@flint/core/types": resolve(import.meta.dirname, "../../packages/core/src/types.ts"),
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "renderer",
          environment: "jsdom",
          include: ["src/renderer/**/*.test.{ts,tsx}"],
          setupFiles: ["src/renderer/test-setup.ts"],
          css: { modules: { classNameStrategy: "non-scoped" } },
        },
      },
      {
        extends: true,
        test: { name: "main", environment: "node", include: ["src/main/**/*.test.ts", "src/preload/**/*.test.ts"] },
      },
    ],
    coverage: { provider: "v8", include: ["src/renderer/src/lib/**", "src/renderer/src/ui/**", "src/renderer/src/mock/**"] },
  },
});
