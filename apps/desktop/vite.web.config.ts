import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Browser preview of the renderer on :5199, backed by the in-memory mock (no Electron). */
export default defineConfig({
  root: resolve(import.meta.dirname, "src/renderer"),
  plugins: [react()],
  resolve: {
    alias: {
      // Only the value-bearing contract files are loaded in the browser; never core's index (node:sqlite).
      "@flint/core/api": resolve(import.meta.dirname, "../../packages/core/src/api.ts"),
      "@flint/core/types": resolve(import.meta.dirname, "../../packages/core/src/types.ts"),
    },
  },
  server: { port: 5199, strictPort: true, host: "127.0.0.1" },
  build: { outDir: resolve(import.meta.dirname, "out/web"), emptyOutDir: true },
});
