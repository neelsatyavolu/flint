import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

// Everything except electron and Node builtins (including node:sqlite) is bundled,
// so @flint/core is compiled from TS source and the packaged app needs no node_modules.
const external = ["electron", /^node:/];

// Lets bundled CommonJS dependencies require() Node builtins from an ESM bundle.
const requireBanner =
  "import { createRequire as __flintCreateRequire } from 'node:module';\n" +
  "const require = __flintCreateRequire(import.meta.url);";

// The Google OAuth client this build ships with, read from the environment at build time (scripts/dist.sh loads it
// from 1Password). It is never committed: Google treats a Desktop client's secret as public, but a secret pushed to
// GitHub gets reported to Google and disabled. Empty means users bring their own client.
const googleClient = {
  clientId: process.env.FLINT_GOOGLE_CLIENT_ID ?? "",
  clientSecret: process.env.FLINT_GOOGLE_CLIENT_SECRET ?? "",
};

export default defineConfig({
  main: {
    define: { __FLINT_GOOGLE_CLIENT__: JSON.stringify(googleClient) },
    build: {
      externalizeDeps: false,
      outDir: "out/main",
      lib: { entry: resolve(__dirname, "src/main/index.ts"), formats: ["es"] },
      rollupOptions: {
        external,
        output: { entryFileNames: "index.js", banner: requireBanner },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      outDir: "out/preload",
      // Sandboxed preload scripts must be CommonJS.
      lib: { entry: resolve(__dirname, "src/preload/index.ts"), formats: ["cjs"] },
      rollupOptions: {
        external: ["electron"],
        output: { entryFileNames: "index.cjs" },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react()],
    build: {
      outDir: resolve(__dirname, "out/renderer"),
      emptyOutDir: true,
      rollupOptions: { input: resolve(__dirname, "src/renderer/index.html") },
    },
  },
});
