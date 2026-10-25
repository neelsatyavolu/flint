import { cleanup, launch, SHOTS, sleep } from "./lib/app.mts";
import { join } from "node:path";

// Boots the packaged Flint.app against a temp data dir and checks it reaches the welcome screen.
const exe = new URL("../release/mac-arm64/Flint.app/Contents/MacOS/Flint", import.meta.url).pathname;
const l = await launch({ executablePath: exe, args: [] });
let ok = false;
try {
  await l.win.getByRole("heading", { name: "Add your first account" }).waitFor({ timeout: 20_000 });
  await sleep(500);
  await l.win.screenshot({ path: join(SHOTS, "packaged-welcome.png") });
  const mock = await l.win.evaluate(async () => (await window.flint.listAccounts()).length);
  console.log(`packaged app booted to the welcome screen (${mock} accounts)`);
  ok = true;
} catch (err) {
  console.log("FAIL", (err as Error).message.split("\n")[0]);
  console.log(l.logs.join("").slice(-2000));
} finally {
  await l.close();
  cleanup(l.dataDir);
}
process.exit(ok ? 0 : 1);
