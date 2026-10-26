import type { Page } from "playwright";
import { sleep } from "./app.mts";
import { GMAIL_PROXY_UA, GOOGLE_NET, type ReceiptsServer } from "./receipts.mts";
import { goTo } from "./ui.mts";

type Shot = (name: string) => Promise<void>;

/**
 * Tracked send through the app, against the local receipts Worker: the app's own pixel load stays
 * unopened, then a Gmail image proxy fetch from another address turns it into Opened.
 */
export async function trackedSendBecomesOpened(win: Page, receipts: ReceiptsServer, shot: Shot, to: string): Promise<string> {
  const subject = "Tracked hello";
  await win.evaluate(async (endpoint) => {
    await window.flint.updateSettings({ receipts: { enabled: true, defaultOn: true, endpoint, notifyOnOpen: false }, compose: { undoSendSeconds: 0 } });
  }, receipts.endpoint);
  const draft = await win.evaluate(async ([subj, address]) => {
    const d = await window.flint.createDraft({ mode: "new", to: [{ name: "Recipient", address: address! }], subject: subj!, html: `<p>${subj}</p>` });
    const sent = await window.flint.sendDraft(d.id);
    return { id: d.id, track: d.track, sent: JSON.stringify(sent) };
  }, [subject, to]);
  if (!draft.track) throw new Error(`draft was not marked for tracking (${JSON.stringify(draft)})`);

  const deadline = Date.now() + 30_000;
  let tokens = await receipts.tokens();
  while (tokens.length === 0 && Date.now() < deadline) {
    await sleep(500);
    tokens = await receipts.tokens();
  }
  const token = tokens.at(-1)?.token;
  if (!token) {
    const queue = await win.evaluate(() => window.flint.listScheduled());
    throw new Error(`the tracked send never registered with the receipts service (${JSON.stringify({ draft, queue })})`);
  }

  // The app's own network loading its pixel (same address that registered the message) must not count.
  await receipts.hit(token, { ua: "Mozilla/5.0 Chrome/126 Safari/537" });
  await win.evaluate(() => window.flint.refreshReceipts());
  const before = await win.evaluate(async (subj) => (await window.flint.listTracked()).find((t) => t.subject === subj)?.summary, subject);
  if (!before) throw new Error("tracked message missing from listTracked");
  if (before.opened !== 0) throw new Error(`self hit counted as an open: ${JSON.stringify(before)}`);

  await goTo(win, "Read Receipts");
  await win.getByText(subject).first().waitFor({ state: "visible", timeout: 10_000 });
  await shot("23-read-statuses-sent");

  // A Gmail image proxy fetch from another address is a real open.
  const status = await receipts.hit(token, { ua: GMAIL_PROXY_UA, ip: "66.249.84.10", cf: GOOGLE_NET });
  if (status !== 200) throw new Error(`pixel answered ${status}`);
  await win.evaluate(() => window.flint.refreshReceipts());
  await win.getByRole("button", { name: "Refresh" }).click();
  await win.getByText(/^Opened/).first().waitFor({ state: "visible", timeout: 10_000 });
  await shot("24-read-statuses-opened");
  const after = await win.evaluate(async (subj) => (await window.flint.listTracked()).find((t) => t.subject === subj)?.summary, subject);
  if (after?.opened !== 1) throw new Error(`expected 1 opened, got ${JSON.stringify(after)}`);
  return `opened ${after.opened}/${after.total}`;
}
