// Loads the BUILT Chromium extension (dist/chromium, with background.js swapped for test/stub-background.js in a temp
// copy) into Playwright's bundled Chromium, serves local pages, and checks + screenshots the suggestion.
// Usage: node test/extension-e2e.mjs [outDir]   (run `pnpm build` first)
import { createServer } from "node:http";
import { cp, mkdtemp, mkdir, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = process.argv[2] ?? "/private/tmp/claude-503/flint-codes/e2e";
const { chromium } = createRequire(import.meta.url)(join(root, "../desktop/node_modules/playwright"));

const page = (dark, body) => `<!doctype html><meta charset=utf-8><title>Sign in</title><style>
body{font:16px system-ui;margin:0;padding:48px;max-width:420px;background:${dark ? "#14120f" : "#fff"};color:${dark ? "#eee" : "#111"};color-scheme:${dark ? "dark" : "light"}}
input{font:inherit;padding:10px;border:1px solid #888;background:transparent;color:inherit;box-sizing:border-box}
#code{width:100%}.split{display:flex;gap:8px}.split input{width:44px;text-align:center}label{display:block;margin:0 0 8px}</style>
<h2>Verify it is you</h2><p>We sent a code to your email.</p>${body}`;
const single = `<label for=code>Verification code</label><input id=code name=otp autocomplete=one-time-code inputmode=numeric maxlength=6>`;
const split = `<label>Enter the 6 digit code</label><div class=split>${Array.from({ length: 6 }, (_, i) => `<input aria-label="Digit ${i + 1}" inputmode=numeric maxlength=1>`).join("")}</div>`;
const pages = { "single-light": page(false, single), "single-dark": page(true, single), "split-light": page(false, split), "split-dark": page(true, split) };

const server = createServer((req, res) => {
  const key = (req.url ?? "/").slice(1);
  res.writeHead(pages[key] ? 200 : 404, { "content-type": "text/html" }).end(pages[key] ?? "");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const ext = await mkdtemp(join(tmpdir(), "flint-ext-"));
await cp(join(root, "dist/chromium"), ext, { recursive: true });
await copyFile(join(here, "stub-background.js"), join(ext, "background.js"));
await mkdir(outDir, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "flint-prof-"));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: true, viewport: { width: 640, height: 380 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "PASS" : "FAIL"} ${what}`); if (!ok) failed++; };
try {
  for (const name of Object.keys(pages)) {
    const dark = name.endsWith("dark");
    const p = await ctx.newPage();
    await p.emulateMedia({ colorScheme: dark ? "dark" : "light" });
    await p.goto(`${base}/${name}`);
    await p.focus(name.startsWith("single") ? "#code" : ".split input");
    await p.waitForTimeout(700);
    await p.screenshot({ path: join(outDir, `${name}.png`) });
    // Closed shadow root: verify by behaviour. Enter fills the first suggestion.
    await p.keyboard.press("Enter");
    await p.waitForTimeout(200);
    const values = await p.$$eval("input", (els) => els.map((e) => e.value));
    if (name.startsWith("single")) check(values[0] === "530331", `${name}: Enter fills 530331 (got ${JSON.stringify(values)})`);
    else check(values.join("") === "530331", `${name}: split inputs filled (got ${JSON.stringify(values)})`);
    await p.screenshot({ path: join(outDir, `${name}-filled.png`) });
    await p.close();
  }
  // Esc dismisses; a plain text field never gets a suggestion.
  const p = await ctx.newPage();
  await p.goto(`${base}/single-light`);
  await p.focus("#code");
  await p.waitForTimeout(500);
  await p.keyboard.press("Escape");
  await p.keyboard.press("Enter");
  check((await p.inputValue("#code")) === "", "Esc dismisses, Enter then fills nothing");
} finally {
  await ctx.close();
  server.close();
  await rm(ext, { recursive: true, force: true });
  await rm(profile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
