// Focused e2e: one account, the local receipts Worker, a tracked send and a simulated Gmail proxy open.
// Run: electron-vite build && node e2e/receipts.e2e.mts
import { cleanup, launch, SHOTS, sleep } from "./lib/app.mts";
import { startReceiptsServer } from "./lib/receipts.mts";
import { trackedSendBecomesOpened } from "./lib/receipts-flow.mts";
import { addImapAccount, startMail } from "./lib/setup.mts";
import { Shooter, step, results, waitForRows, CONFIGS } from "./lib/ui.mts";

const gm = await startMail();
const receipts = await startReceiptsServer();
const l = await launch();
const sh = new Shooter(l);
sh.use(CONFIGS[1]!);
try {
  await step("add account", async () => {
    await addImapAccount(l.win, gm, "alice", "Alice Moreau", { dialog: false });
    await waitForRows(l.win, 5);
  });
  await step("tracked send becomes Opened", () => trackedSendBecomesOpened(l.win, receipts, (n) => sh.shot(n), "carol@test.local"));
} finally {
  console.log("\n--- app logs (tail) ---\n" + l.logs.join("").slice(-2500));
  await l.close();
  await receipts.stop();
  await gm.stop();
  cleanup(l.dataDir);
}
void SHOTS; void sleep;
process.exit(results.every((r) => r.ok) ? 0 : 1);
