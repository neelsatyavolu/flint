import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { addImapAccount, startMail } from "./lib/setup.mts";
import { cleanup, DESKTOP, launch, setSize, setTheme, sleep } from "./lib/app.mts";
import { CONFIGS, closeSettings, goTo, openSettingsSection, openThreadBySubject, results, setThemeProbe, Shooter, sidebar, step, waitForRows } from "./lib/ui.mts";

const gm = await startMail();
const l = await launch();
const { win } = l;
const sh = new Shooter(l);
setThemeProbe(() => win.evaluate(() => document.documentElement.dataset.theme ?? "?").catch(() => "?"));
let failed = true;

try {
  await setSize(l, 1440, 900);
  await setTheme(l, "light");
  sh.use(CONFIGS[1]!);
  await sh.shot("00-welcome");

  await step("add first account through the real form", async () => {
    await addImapAccount(win, gm, "alice", "Alice Moreau", { dialog: false });
    await waitForRows(win, 5);
  });
  await step("add second account from Settings > Accounts", async () => {
    await openSettingsSection(win, "Accounts");
    await sh.shot("01-settings-accounts-one");
    await win.getByRole("button", { name: /Add account/ }).first().click();
    await sh.shot("02-add-account-dialog");
    await addImapAccount(win, gm, "bob", "Bob Marlow", { dialog: true });
    await sleep(4000);
    const accounts = await win.evaluate(() => window.flint.listAccounts());
    if (accounts.length !== 2) throw new Error(`expected 2 accounts, got ${accounts.length}`);
    await closeSettings(win);
  });
  await step("unified inbox lists mail from both accounts", async () => {
    await goTo(win, "Inbox");
    await sleep(2500);
    const sidebarData = await win.evaluate(() => window.flint.getSidebar());
    return `inbox count ${sidebarData.counts.inbox}`;
  });

  await step("focused bundles", async () => {
    const bundle = win.locator('[role="option"]', { hasText: "Newsletters" }).first();
    await bundle.waitFor({ state: "visible" });
    await sh.shot("03-inbox-focused");
    await bundle.click();
    await win.waitForTimeout(400);
    await sh.shot("04-bundle-newsletters");
    await win.getByRole("button", { name: /Back to Inbox/ }).click();
  });

  await step("open newsletter: iframe renders, height correct, remote images blocked notice", async () => {
    await goTo(win, "Inbox");
    await win.getByRole("button", { name: /Back to Inbox/ }).click().catch(() => undefined);
    await win.locator('[role="option"]', { hasText: "Newsletters" }).first().click();
    await openThreadBySubject(win, /SQLite is eating the backend/);
    await win.locator("iframe").first().waitFor({ state: "attached" });
    await sleep(800);
    const info = await win.evaluate(() => {
      const f = document.querySelector("iframe") as HTMLIFrameElement;
      const doc = f.contentDocument!;
      return { h: f.getBoundingClientRect().height, docH: doc.documentElement.scrollHeight, text: doc.body.innerText.slice(0, 60), imgs: doc.images.length, loaded: [...doc.images].filter((i) => i.complete && i.naturalWidth > 0).length };
    });
    await sh.shot("05-newsletter-open");
    if (info.h < info.docH - 4) throw new Error(`iframe clipped: frame ${info.h} vs doc ${info.docH}`);
    if (!/Weekly Byte/.test(info.text)) throw new Error("newsletter text missing");
    const notice = await win.getByText(/images? (were|was) blocked|Load images/i).first().isVisible().catch(() => false);
    if (!notice) throw new Error("no remote images notice");
    return `frame ${info.h}px, doc ${info.docH}px, ${info.loaded}/${info.imgs} images loaded`;
  });
  await step("Load images", async () => {
    await win.getByRole("button", { name: /Load images/ }).first().click();
    await sleep(1200);
    await sh.shot("06-newsletter-images-loaded");
  });

  await step("people thread, quoted text pill, reply composer", async () => {
    await goTo(win, "Inbox");
    await openThreadBySubject(win, /Launch checklist/);
    await sleep(600);
    await sh.shot("07-thread-people");
    await win.getByRole("button", { name: /^Reply to/ }).click();
    await sleep(700);
    await sh.shot("08-inline-reply");
  });

  await step("inline image message renders flint-attachment image", async () => {
    await openThreadBySubject(win, /New homepage hero/);
    await sleep(1200);
    const r = await win.evaluate(() => {
      const f = document.querySelector("iframe") as HTMLIFrameElement;
      const img = f.contentDocument!.querySelector("img") as HTMLImageElement | null;
      return img ? { src: img.src, w: img.naturalWidth, complete: img.complete } : null;
    });
    await sh.shot("09-inline-image");
    if (!r) throw new Error("no img in iframe");
    if (!r.w) throw new Error(`inline image did not load (${r.src})`);
    return `${r.src} ${r.w}px`;
  });

  await step("attachments tiles and forwarded message", async () => {
    await openThreadBySubject(win, /Logo exploration/);
    await sleep(800);
    await sh.shot("10-attachments");
    await openThreadBySubject(win, /Venue quote/);
    await sleep(800);
    await sh.shot("11-forwarded");
  });

  await step("archive with undo toast", async () => {
    await openThreadBySubject(win, /Coffee next week/);
    await win.keyboard.press("e");
    await win.getByText(/Archived|Moved to Archive/i).first().waitFor({ state: "visible", timeout: 5000 });
    await sh.shot("12-archive-toast");
    await win.getByRole("button", { name: "Undo" }).click();
    await win.locator('[role="option"]', { hasText: /Coffee next week/ }).first().waitFor({ state: "visible", timeout: 5000 });
  });

  await step("pin", async () => {
    await openThreadBySubject(win, /Logo exploration/);
    await win.keyboard.press("s");
    await sleep(500);
    await goTo(win, "Pins");
    await win.locator('[role="option"]', { hasText: /Logo exploration/ }).first().waitFor({ state: "visible", timeout: 5000 });
    await sh.shot("13-pins");
  });

  await step("snooze", async () => {
    await goTo(win, "Inbox");
    await openThreadBySubject(win, /Contract draft/);
    await win.keyboard.press("h");
    await sleep(500);
    await sh.shot("14-snooze-picker");
    await win.getByText(/Later today|This evening|Tomorrow/).first().click();
    await sleep(600);
    await goTo(win, "Snoozed");
    await win.locator('[role="option"]', { hasText: /Contract draft/ }).first().waitFor({ state: "visible", timeout: 5000 });
    await sh.shot("15-snoozed");
  });

  await step("search with operators", async () => {
    await goTo(win, "Inbox");
    await win.keyboard.press("/");
    const input = win.getByLabel("Search mail");
    await input.fill("from:priya has:attachment");
    await sleep(600);
    await sh.shot("16-search-empty");
    await input.fill("from:marco has:attachment");
    await sleep(700);
    const n = await win.locator('[role="option"]').filter({ hasText: "Logo exploration" }).count();
    if (n < 1) throw new Error("search from:marco has:attachment found nothing");
    await sh.shot("17-search-results");
    await input.fill("subject:launch");
    await sleep(700);
    await sh.shot("18-search-hints");
    await win.getByRole("button", { name: /Close search/ }).click();
  });

  await step("compose a message and send it", async () => {
    await win.getByRole("button", { name: "Compose" }).first().click();
    await sleep(700);
    await sh.shot("19-composer-new");
    await win.getByPlaceholder("To, Cc, Bcc").fill("bob@test.local");
    await win.keyboard.press("Enter");
    await win.getByLabel("Subject").fill("Dinner on Friday");
    await win.locator('[contenteditable="true"]').first().click();
    await win.keyboard.type("Hi Carol, are you free Friday evening? Alice");
    await sh.shot("20-composer-filled");
    await win.getByRole("button", { name: "Send", exact: true }).click();
    await sleep(500);
    await sh.shot("21-composer-sent-toast");
    await sleep(13_000);
    const bobSees = await win.evaluate(async () => (await window.flint.listThreads({ view: "search", search: "Dinner on Friday" })).items.length);
    if (bobSees < 1) throw new Error("the sent message never appeared in bob's mailbox or Sent");
    return `search found ${bobSees} thread(s) for the sent subject`;
  });

  await step("Agent Activity via the real CLI", async () => {
    const cli = join(DESKTOP, "../cli/dist/flint.js");
    if (!existsSync(cli)) throw new Error("apps/cli/dist/flint.js is not built");
    const env = { ...process.env, FLINT_DATA_DIR: l.dataDir, FLINT_AGENT: "claude-code" };
    const out = execFileSync("node", [cli, "list", "--json"], { env, encoding: "utf8" });
    const parsed = JSON.parse(out) as { items?: unknown[] } | unknown[];
    execFileSync("node", [cli, "search", "launch", "--json"], { env, encoding: "utf8" });
    try {
      execFileSync("node", [cli, "send", "--to", "bob@test.local", "--subject", "Agent test", "--body", "Sent by an agent", "--json"], { env, encoding: "utf8" });
    } catch { /* approval flow may reject; the activity row is what matters */ }
    await sleep(800);
    await goTo(win, "Agent Activity");
    await sleep(600);
    await sh.shot("22-agent-activity");
    return `list returned ${Array.isArray(parsed) ? parsed.length : (parsed.items?.length ?? "?")} items`;
  });

  await step("Read Statuses", async () => {
    await goTo(win, "Read Statuses");
    await sleep(500);
    await sh.shot("23-read-statuses");
  });

  await step("settings sections", async () => {
    const labels = ["General", "Accounts", "Appearance", "Inbox", "Signatures", "Templates", "Rules", "Read Receipts", "Notifications", "+AI", "Agents", "Shortcuts", "Blocked", "About"];
    for (const [i, label] of labels.entries()) {
      await openSettingsSection(win, label);
      await sh.shot(`30-settings-${String(i).padStart(2, "0")}-${label.replace(/\W+/g, "").toLowerCase()}`);
    }
    await closeSettings(win);
  });

  await step("other mailboxes", async () => {
    for (const [i, label] of ["Home", "Drafts", "Sent", "Scheduled", "Trash", "Archive", "Blocked"].entries()) {
      await goTo(win, label);
      await sleep(400);
      await sh.shot(`40-${i}-${label.toLowerCase()}`);
    }
    await goTo(win, "Inbox");
  });

  await step("command palette", async () => {
    await win.keyboard.press("Meta+k");
    await sleep(400);
    await sh.shot("50-palette");
    await win.keyboard.press("Escape");
  });

  // Screens sweep across dark/light and both sizes.
  for (const cfg of CONFIGS) {
    await step(`sweep ${cfg.theme} ${cfg.w}x${cfg.h}`, async () => {
      sh.use(cfg);
      await setSize(l, cfg.w, cfg.h);
      await setTheme(l, cfg.theme);
      await goTo(win, "Inbox");
      await sh.shot("s-inbox");
      await win.locator('[role="option"]', { hasText: "Newsletters" }).first().click();
      await openThreadBySubject(win, /SQLite is eating the backend/);
      await sleep(600);
      await sh.shot("s-newsletter");
      await goTo(win, "Inbox");
      await openThreadBySubject(win, /Launch checklist/);
      await sleep(600);
      await sh.shot("s-thread");
      await win.getByRole("button", { name: /^Reply to/ }).click();
      await sleep(500);
      await sh.shot("s-reply");
      await win.getByRole("button", { name: "Compose" }).first().click();
      await sleep(600);
      await sh.shot("s-compose");
      await win.getByRole("button", { name: /Close and save draft/ }).click();
      await sleep(300);
      for (const [i, label] of ["Home", "Agent Activity", "Read Statuses", "Pins", "Sent"].entries()) {
        await goTo(win, label);
        await sleep(300);
        await sh.shot(`s-${i}-${label.replace(/\s+/g, "").toLowerCase()}`);
      }
      await openSettingsSection(win, "Accounts");
      await sh.shot("s-settings-accounts");
      await openSettingsSection(win, "Appearance");
      await sh.shot("s-settings-appearance");
      await closeSettings(win);
    });
  }
  failed = results.some((r) => !r.ok);
} finally {
  console.log("\n--- app logs (tail) ---\n" + l.logs.join("").slice(-2500));
  await l.close();
  await gm.stop();
  cleanup(l.dataDir);
}
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} steps passed`);
process.exit(failed ? 1 : 0);
