import type { Page } from "playwright";
import { startGreenMail, type GreenMail } from "../../../../packages/core/test/greenmail.ts";
import { launch, sleep, type Launched, type LaunchOptions } from "./app.mts";
import { seedMail } from "./seed.mts";

export type Rig = { gm: GreenMail; app: Launched };

export async function startMail(): Promise<GreenMail> {
  const gm = await startGreenMail({ users: ["alice", "bob", "carol"] });
  await seedMail(gm, ["alice", "bob"]);
  return gm;
}

/** Fills the real AddAccount IMAP form (manual servers, since GreenMail is on localhost) and submits it. */
export async function addImapAccount(win: Page, gm: GreenMail, name: string, displayName: string, opts: { dialog: boolean }): Promise<void> {
  const user = gm.user(name);
  if (opts.dialog) {
    // Settings > Accounts > Add account is exercised by the caller; the form below is identical.
  }
  await win.getByRole("button", { name: /Other \(IMAP\)/ }).click();
  await win.getByLabel("Email", { exact: true }).fill(user.email);
  await win.getByLabel("Name", { exact: true }).fill(displayName);
  await win.getByLabel("Password", { exact: true }).fill(user.password);
  await win.getByRole("button", { name: /Edit servers|Hide servers/ }).click().catch(() => undefined);
  const group = win.getByRole("group", { name: "Server settings" });
  if (!(await group.isVisible().catch(() => false))) await win.getByRole("button", { name: "Edit servers" }).click();
  await group.getByLabel("IMAP server").fill(gm.host);
  await group.getByLabel("IMAP port").fill(String(gm.imapPort));
  await group.getByLabel("SMTP server").fill(gm.host);
  await group.getByLabel("SMTP port").fill(String(gm.smtpPort));
  const ssl = group.getByRole("checkbox");
  for (const i of [0, 1]) if (await ssl.nth(i).isChecked()) await ssl.nth(i).click();
  await group.getByLabel("Username").fill(name);
  await win.getByRole("button", { name: "Connect" }).click();
}

export async function launchWith(gm: GreenMail, opts: LaunchOptions = {}): Promise<Rig> {
  const app = await launch(opts);
  await sleep(500);
  return { gm, app };
}
