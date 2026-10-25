import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImapFlow } from "imapflow";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAsAgent } from "../src/agent/context";
import { memorySecrets, type Platform } from "../src/platform";
import { createFlintService, type FlintService } from "../src/service";
import type { FlintEvent, Folder, ThreadListItem } from "../src/types";
import { tryStartGreenMail, TEST_DOMAIN, type GreenMail } from "./greenmail";
import { waitFor } from "./harness";

const gm: GreenMail | null = await tryStartGreenMail({ users: ["svc", "gone", "resign"] });
afterAll(async () => { await gm?.stop(); });

const DAY = 24 * 60 * 60 * 1000;
const TRACKER = "https://pixel.mailtrack.io/trace/abc.gif";
const HERO = "https://cdn.remote.example/hero.png";

type Rig = { service: FlintService; platform: Platform; events: FlintEvent[]; opened: string[]; notified: string[]; fetches: { url: string; method?: string; body?: string }[]; secrets: ReturnType<typeof memorySecrets>; dataDir: string; downloads: string };

function makePlatform(): Omit<Rig, "service"> & { platform: Platform } {
  const dataDir = mkdtempSync(join(tmpdir(), "flint-svc-"));
  const downloads = mkdtempSync(join(tmpdir(), "flint-dl-"));
  const secrets = memorySecrets();
  const opened: string[] = [];
  const notified: string[] = [];
  const platform: Platform = {
    dataDir, downloadsDir: downloads, secrets, appVersion: "0.0.0-test",
    openExternal: async (url) => { opened.push(url); },
    openPath: async (path) => { opened.push(path); },
    notify: (n) => { notified.push(n.title); },
  };
  return { platform, events: [], opened, notified, fetches: [], secrets, dataDir, downloads };
}

async function boot(extra: { agentServer?: boolean } = {}): Promise<Rig> {
  const base = makePlatform();
  const service = await createFlintService(base.platform, {
    ...extra,
    sync: { pollMs: 500, idlePollMs: 5_000, backoff: { minMs: 200, maxMs: 1000 } },
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      base.fetches.push({ url: String(url), ...(init?.method ? { method: init.method } : {}), ...(typeof init?.body === "string" ? { body: init.body } : {}) });
      return new Response("ok", { status: 200 });
    }) as typeof fetch,
  });
  service.subscribe((e) => base.events.push(e));
  await service.start();
  return { ...base, service };
}

const serverFor = (name: string) => ({
  imapHost: gm!.host, imapPort: gm!.imapPort, imapSecure: false, smtpHost: gm!.host, smtpPort: gm!.smtpPort, smtpSecure: false, username: name,
});
const signIn = (service: FlintService, name: string, password = "secret") =>
  service.addAccount({ email: `${name}@${TEST_DOMAIN}`, name: name.toUpperCase(), password, server: serverFor(name) });

async function onServer<T>(name: string, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const c = new ImapFlow({ host: gm!.host, port: gm!.imapPort, secure: false, auth: { user: name, pass: "secret" }, logger: false });
  c.on("error", () => undefined);
  await c.connect();
  try { return await fn(c); } finally { await c.logout().catch(() => c.close()); }
}

async function mailbox(name: string, path: string): Promise<{ uid: number; flags: string[]; subject: string }[]> {
  return onServer(name, async (c) => {
    if (!(await c.list()).some((b) => b.path === path)) return [];
    const lock = await c.getMailboxLock(path, { readOnly: true });
    try {
      const out = [];
      for await (const m of c.fetch("1:*", { uid: true, flags: true, envelope: true })) out.push({ uid: m.uid, flags: [...(m.flags ?? [])], subject: m.envelope?.subject ?? "" });
      return out;
    } catch {
      return [];
    } finally { lock.release(); }
  });
}

const subjectsIn = async (path: string) => (await mailbox("svc", path)).map((m) => m.subject);
const find = (items: ThreadListItem[], subject: string): ThreadListItem => {
  const hit = items.find((t) => t.subject === subject);
  if (!hit) throw new Error(`No thread "${subject}" in ${items.map((t) => t.subject).join(", ")}`);
  return hit;
};

describe.skipIf(!gm)("FlintService backbone against GreenMail", { timeout: 60_000 }, () => {
  let rig: Rig;
  let accountId = "";
  const inbox = async (focused = false) => (await rig.service.listThreads({ view: "inbox", focused })).items;

  beforeAll(async () => {
    const to = `svc@${TEST_DOMAIN}`;
    await gm!.deliver({ to, from: "Maria <maria@remote.example>", subject: "Lunch on Friday", text: "Are you free for lunch on Friday?" });
    await gm!.deliver({
      to, from: "Daily Brief <news@remote.example>", subject: "The Daily Brief", text: "Today in news",
      headers: { "List-Unsubscribe": "<https://news.remote.example/u/1>, <mailto:unsub@news.remote.example?subject=unsubscribe>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click", "List-Id": "brief.news.remote.example" },
    });
    await gm!.deliver({ to, from: "Shop <no-reply@remote.example>", subject: "Your order has shipped", text: "Order 1234 is on the way", headers: { "Auto-Submitted": "auto-generated" } });
    let prev = "";
    const refs: string[] = [];
    for (const [i, who] of ["Priya", "Tom", "Priya", "Tom"].entries()) {
      const id = `<plan-${i}@remote.example>`;
      await gm!.deliver({
        to, from: `${who} <${who.toLowerCase()}@remote.example>`, subject: i === 0 ? "Project plan" : "Re: Project plan", text: `Plan message ${i + 1}`,
        messageId: id, ...(prev ? { inReplyTo: prev, references: refs.join(" ") } : {}),
      });
      refs.push(id);
      prev = id;
    }
    await gm!.deliver({
      to, from: "Hana <hana@remote.example>", subject: "Photos and tracking", date: new Date(Date.now() - 30 * DAY),
      html: `<p>Hello <b>there</b></p><img src="${HERO}" width="200" height="100"><img src="${TRACKER}" width="1" height="1">`,
    });
    await gm!.deliver({ to, from: "Omar <omar@remote.example>", subject: "Contract attached", text: "See attached", attachments: [{ filename: "contract.txt", content: "agreed terms", contentType: "text/plain" }] });

    rig = await boot();
    const account = await signIn(rig.service, "svc");
    accountId = account.id;
    await waitFor(async () => (await inbox()).length >= 6, "initial sync of 6 threads", 30_000);
  });

  afterAll(async () => { await rig?.service.stop(); });

  it("lists the inbox as focused people plus bundles", async () => {
    const page = await rig.service.listThreads({ view: "inbox", focused: true });
    const subjects = page.items.map((t) => t.subject).sort();
    expect(subjects).toEqual(["Contract attached", "Lunch on Friday", "Photos and tracking", "Project plan"]);
    expect(find(page.items, "Project plan").messageCount).toBe(4);
    expect(page.bundles.map((b) => b.category).sort()).toEqual(["newsletters", "notifications"]);
    const all = await inbox();
    expect(find(all, "The Daily Brief").category).toBe("newsletters");
    expect(find(all, "Your order has shipped").category).toBe("notifications");
  });

  it("reports sync status and sidebar counts", async () => {
    const statuses = await rig.service.getSyncStatus();
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ accountId });
    const sidebar = await rig.service.getSidebar();
    expect(sidebar.counts.inbox).toBe(6);
    expect(sidebar.accounts[0]).toMatchObject({ inboxUnread: 6, sync: { accountId } });
    expect(sidebar.accounts[0]!.folders.some((f) => f.role === "inbox")).toBe(true);
    const types = new Set(rig.events.map((e) => e.type));
    expect(types.has("sync")).toBe(true);
    expect(types.has("mail_changed")).toBe(true);
  });

  it("loads missing bodies and sanitizes: remote images blocked, trackers stripped", async () => {
    const id = find(await inbox(), "Photos and tracking").id;
    const thread = await rig.service.getThread(id);
    const m = thread.messages[0]!;
    expect(m.bodyLoaded).toBe(true);
    expect(m.html).toContain("there");
    expect(m.html).not.toContain(HERO);
    expect(m.html).not.toContain("mailtrack.io");
    expect(m.hasTrackers).toBe(true);
    expect(m.remoteImages).toBe("blocked");

    const allowed = await rig.service.allowRemoteImages(m.id, false);
    expect(allowed.remoteImages).toBe("allowed");
    expect(allowed.html).toContain(HERO);
    expect(allowed.html).not.toContain("mailtrack.io");
    expect((await rig.service.getMessage(m.id)).remoteImages).toBe("allowed");
  });

  it("remembers a sender when asked to always allow", async () => {
    const lunch = (await rig.service.getThread(find(await inbox(), "Lunch on Friday").id)).messages[0]!;
    await rig.service.allowRemoteImages(lunch.id, true);
    const settings = await rig.service.getSettings();
    expect(settings.inbox.remoteImages).toBe("known_senders");
    await gm!.deliver({ to: `svc@${TEST_DOMAIN}`, from: "Maria <maria@remote.example>", subject: "Lunch photos", html: `<img src="${HERO}" width="50" height="50">` });
    const next = await waitFor(async () => (await inbox()).find((t) => t.subject === "Lunch photos"), "second mail from Maria");
    const msg = (await rig.service.getThread(next.id)).messages[0]!;
    expect(msg.remoteImages).toBe("allowed");
    expect(msg.html).toContain(HERO);
  });

  it("saves attachments with unique names and opens them", async () => {
    const thread = await rig.service.getThread(find(await inbox(), "Contract attached").id);
    const att = thread.messages[0]!.attachments[0]!;
    expect(att.filename).toBe("contract.txt");
    const first = await rig.service.saveAttachment(att.id);
    const second = await rig.service.saveAttachment(att.id);
    expect(first).toBe(join(rig.downloads, "contract.txt"));
    expect(second).toBe(join(rig.downloads, "contract (1).txt"));
    expect(readFileSync(first, "utf8")).toBe("agreed terms");
    await rig.service.openAttachment(att.id);
    expect(rig.opened.at(-1)).toContain("contract.txt");
    await expect(runAsAgent("claude", () => rig.service.saveAttachment(att.id, join(rig.downloads, "chosen.txt")))).rejects.toMatchObject({ code: "permission" });
    expect(existsSync(join(rig.downloads, "chosen.txt"))).toBe(false);
    expect(await rig.service.saveAttachment(att.id, join(rig.downloads, "chosen.txt"))).toBe(join(rig.downloads, "chosen.txt"));
  });

  it("marks read and pins on the server", async () => {
    const id = find(await inbox(), "Lunch on Friday").id;
    await rig.service.markRead([id], true);
    await rig.service.setPinned([id], true);
    const lunch = (await mailbox("svc", "INBOX")).find((m) => m.subject === "Lunch on Friday")!;
    expect(lunch.flags).toEqual(expect.arrayContaining(["\\Seen", "\\Flagged"]));
    expect((await rig.service.listThreads({ view: "pinned" })).items.map((t) => t.subject)).toContain("Lunch on Friday");
    const { undoToken } = await rig.service.setPinned([id], false);
    await rig.service.undo(undoToken);
    expect((await mailbox("svc", "INBOX")).find((m) => m.subject === "Lunch on Friday")!.flags).toContain("\\Flagged");
    await rig.service.setPinned([id], false);
    await rig.service.markRead([id], false);
  });

  it("archives on the server and undo puts the mail back", async () => {
    const id = find(await inbox(), "Your order has shipped").id;
    const { undoToken } = await rig.service.archive([id]);
    expect(await subjectsIn("INBOX")).not.toContain("Your order has shipped");
    expect(await subjectsIn("Archive")).toContain("Your order has shipped");
    expect((await inbox()).map((t) => t.subject)).not.toContain("Your order has shipped");

    await rig.service.undo(undoToken);
    expect(await subjectsIn("INBOX")).toContain("Your order has shipped");
    expect(await subjectsIn("Archive")).not.toContain("Your order has shipped");
    expect((await inbox()).map((t) => t.subject)).toContain("Your order has shipped");
    await expect(rig.service.undo(undoToken)).rejects.toMatchObject({ code: "not_found" });
  });

  it("trashes on the server, creating the Trash folder when the server has none", async () => {
    const id = find(await inbox(), "The Daily Brief").id;
    await rig.service.trash([id]);
    expect(await subjectsIn("Trash")).toContain("The Daily Brief");
    expect(await subjectsIn("INBOX")).not.toContain("The Daily Brief");
    expect((await rig.service.listThreads({ view: "trash" })).items.map((t) => t.subject)).toContain("The Daily Brief");
    await rig.service.moveToInbox([id]);
    expect(await subjectsIn("INBOX")).toContain("The Daily Brief");
  });

  it("moves into a user folder opened for the first time", async () => {
    await onServer("svc", async (c) => { await c.mailboxCreate("Projects"); });
    await rig.service.syncNow(accountId);
    const folder = await waitFor(async () => (await rig.service.listFolders(accountId)).find((f: Folder) => f.path === "Projects"), "Projects folder");
    const id = find(await inbox(), "Project plan").id;
    await rig.service.moveToFolder([id], folder.id);
    expect((await subjectsIn("Projects")).length).toBe(4);
    const opened = await rig.service.listThreads({ view: "folder", folderId: folder.id });
    expect(opened.items.map((t) => t.subject)).toContain("Project plan");
  });

  it("snoozes locally and wakes with unsnooze", async () => {
    const id = find(await inbox(), "Contract attached").id;
    await rig.service.snooze([id], Date.now() + 3_600_000);
    expect((await inbox()).map((t) => t.subject)).not.toContain("Contract attached");
    expect((await rig.service.getSidebar()).counts.snoozed).toBe(1);
    await rig.service.unsnooze([id]);
    expect((await inbox()).map((t) => t.subject)).toContain("Contract attached");
  });

  it("unsubscribes with a one-click POST, else mailto through the compose hook", async () => {
    const brief = (await rig.service.getThread(find(await inbox(), "The Daily Brief").id)).messages[0]!;
    expect(brief.unsubscribe).toMatchObject({ oneClick: true, url: "https://news.remote.example/u/1" });
    await expect(rig.service.unsubscribe(brief.id)).resolves.toEqual({ method: "one_click" });
    expect(rig.fetches.at(-1)).toMatchObject({ url: "https://news.remote.example/u/1", method: "POST", body: "List-Unsubscribe=One-Click" });

    const lunch = (await rig.service.getThread(find(await inbox(), "Lunch on Friday").id)).messages[0]!;
    await expect(rig.service.unsubscribe(lunch.id)).rejects.toMatchObject({ code: "not_found" });

    await gm!.deliver({ to: `svc@${TEST_DOMAIN}`, from: "Club <club@remote.example>", subject: "Club notes", text: "notes", headers: { "List-Unsubscribe": "<mailto:leave@club.remote.example>" } });
    const club = await waitFor(async () => (await inbox()).find((t) => t.subject === "Club notes"), "mailto-only newsletter");
    const clubMsg = (await rig.service.getThread(club.id)).messages[0]!;
    await expect(rig.service.unsubscribe(clubMsg.id)).resolves.toEqual({ method: "mailto" });
  });

  it("blocks a sender: new mail goes to Trash and the Blocked view", async () => {
    await gm!.deliver({ to: `svc@${TEST_DOMAIN}`, from: "Spammer <spammer@remote.example>", subject: "Earlier note", text: "before the block" });
    await waitFor(async () => (await inbox()).find((t) => t.subject === "Earlier note"), "mail from the sender before blocking");
    await rig.service.blockSender("Spammer@Remote.example");
    expect(await subjectsIn("Trash")).toContain("Earlier note");
    expect(await rig.service.listBlocked()).toEqual([expect.objectContaining({ pattern: "spammer@remote.example" })]);
    expect((await rig.service.listThreads({ view: "blocked" })).items.map((t) => t.subject)).toContain("Earlier note");
    await gm!.deliver({ to: `svc@${TEST_DOMAIN}`, from: "Spammer <spammer@remote.example>", subject: "Win a prize", text: "click here" });
    await waitFor(async () => (await subjectsIn("Trash")).includes("Win a prize"), "blocked mail trashed on the server", 20_000);
    await waitFor(async () => (await rig.service.listThreads({ view: "blocked" })).items.length === 2, "blocked view");
    expect((await inbox()).map((t) => t.subject)).not.toContain("Win a prize");

    await rig.service.unblockSender("spammer@remote.example");
    expect(await rig.service.listBlocked()).toEqual([]);
    await waitFor(async () => (await subjectsIn("INBOX")).includes("Win a prize"), "unblocked mail back in the inbox");
    expect((await inbox()).map((t) => t.subject)).toContain("Win a prize");
  });

  it("emits new_mail, settings and notifications", async () => {
    await rig.service.updateSettings({ notifications: { enabled: true, scope: "all", sound: false } });
    await gm!.deliver({ to: `svc@${TEST_DOMAIN}`, from: "Zed <zed@remote.example>", subject: "Fresh arrival", text: "hi" });
    await waitFor(() => rig.events.some((e) => e.type === "new_mail" && e.subject === "Fresh arrival"), "new_mail event");
    expect(rig.events.some((e) => e.type === "settings")).toBe(true);
    expect(rig.notified).toContain("Zed");
  });

  it("explains a missing Google client", async () => {
    await expect(rig.service.addGoogleAccount()).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("Google client") });
  });
});

describe.skipIf(!gm)("accounts", { timeout: 60_000 }, () => {
  it("removeAccount stops sync, deletes secrets, rows and cached attachments", async () => {
    await gm!.deliver({ to: `gone@${TEST_DOMAIN}`, subject: "Doomed", text: "bye", attachments: [{ filename: "a.txt", content: "x", contentType: "text/plain" }] });
    const rig = await boot();
    try {
      const account = await signIn(rig.service, "gone");
      await waitFor(async () => (await rig.service.listThreads({ view: "inbox" })).items.length === 1, "sync");
      const thread = await rig.service.getThread((await rig.service.listThreads({ view: "inbox" })).items[0]!.id);
      await rig.service.openAttachment(thread.messages[0]!.attachments[0]!.id);
      expect(existsSync(join(rig.dataDir, "attachments"))).toBe(true);
      expect(await rig.secrets.get(`account:${account.id}`)).not.toBeNull();

      await rig.service.removeAccount(account.id);
      expect(await rig.service.listAccounts()).toEqual([]);
      expect(await rig.secrets.get(`account:${account.id}`)).toBeNull();
      expect((await rig.service.listThreads({ view: "inbox" })).items).toEqual([]);
      expect(await rig.service.getSyncStatus()).toEqual([]);
      expect(existsSync(join(rig.dataDir, "attachments", account.id))).toBe(false);
      await expect(rig.service.syncNow(account.id)).rejects.toMatchObject({ code: "not_found" });
    } finally { await rig.service.stop(); }
  });

  it("signing in again with the same email updates the password instead of failing", async () => {
    const rig = await boot();
    try {
      const first = await signIn(rig.service, "resign");
      await expect(signIn(rig.service, "resign", "wrong")).rejects.toMatchObject({ code: "auth" });
      const again = await signIn(rig.service, "resign", "secret");
      expect(again.id).toBe(first.id);
      expect(await rig.service.listAccounts()).toHaveLength(1);
      expect(JSON.parse((await rig.secrets.get(`account:${first.id}`))!)).toEqual({ password: "secret" });
    } finally { await rig.service.stop(); }
  });

  it("disabling an account stops its sync and enabling restarts it", async () => {
    const rig = await boot();
    try {
      const account = await signIn(rig.service, "resign");
      await rig.service.updateAccount(account.id, { enabled: false });
      expect((await rig.service.listAccounts())[0]!.enabled).toBe(false);
      await rig.service.updateAccount(account.id, { enabled: true, name: "Renamed" });
      expect((await rig.service.listAccounts())[0]).toMatchObject({ enabled: true, name: "Renamed" });
      await expect(rig.service.updateAccount(account.id, { color: 5 as unknown as string })).rejects.toMatchObject({ code: "invalid" });
    } finally { await rig.service.stop(); }
  });

  it("starts the agent API socket when asked and removes it on stop", async () => {
    const rig = await boot({ agentServer: true });
    const socket = join(rig.dataDir, "agent.sock");
    expect(existsSync(socket)).toBe(true);
    await rig.service.stop();
    expect(existsSync(socket)).toBe(false);
  });

  it("testConnection reports each server, autoconfig knows Gmail", async () => {
    const rig = await boot();
    try {
      const input = { email: `svc@${TEST_DOMAIN}`, name: "S", password: "secret", server: serverFor("svc") };
      expect(await rig.service.testConnection(input)).toEqual({ imap: "ok", smtp: "ok" });
      const bad = await rig.service.testConnection({ ...input, password: "nope" });
      expect(bad.imap).not.toBe("ok");
      expect(await rig.service.autoconfig("someone@gmail.com")).toMatchObject({ imapHost: "imap.gmail.com", imapSecure: true });
      expect(await rig.service.autoconfig("not an address")).toBeNull();
    } finally { await rig.service.stop(); }
  });
});
