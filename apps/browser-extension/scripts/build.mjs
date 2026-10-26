// Bundles the extension into dist/chromium and dist/firefox. Local files only: no network, no remote code.
import { build } from "esbuild";
import { cp, mkdir, rm, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  { name: "chromium", manifest: "manifest.chromium.json", target: "chrome110" },
  { name: "firefox", manifest: "manifest.firefox.json", target: "firefox115" },
];

for (const t of targets) {
  const out = join(root, "dist", t.name);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await build({
    entryPoints: [join(root, "src/content.ts"), join(root, "src/background.ts")],
    outdir: out,
    bundle: true,
    format: "iife",
    target: t.target,
    minify: true,
    legalComments: "none",
    logLevel: "warning",
  });
  await copyFile(join(root, t.manifest), join(out, "manifest.json"));
  await cp(join(root, "icons"), join(out, "icons"), { recursive: true, filter: (src) => !src.endsWith(".svg") });
}
console.log("built dist/chromium and dist/firefox");
