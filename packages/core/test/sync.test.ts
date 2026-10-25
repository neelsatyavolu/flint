import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tryStartGreenMail, type GreenMail } from "./greenmail";
import { addr, makeRig, uidsIn, waitFor } from "./harness";

const gm: GreenMail | null = await tryStartGreenMail({ users: ["alice", "bob", "carol", "dave", "erin", "frank", "gina", "hank"] });
afterAll(async () => { await gm?.stop(); });

describe.skipIf(!gm)("IMAP sync against GreenMail", () => {
  let g: GreenMail;
  beforeAll(() => { g = gm!; });

  it("initial sync fills the store and groups threads", async () => {
    const rig = makeRig(g, "alice");
    await g.deliver({ to: addr("alice"), subject: "Lunch plans", text: "Where shall we eat?", messageId: "<lunch-1@remote.example>" });
    await g.deliver({ to: addr("alice"), subject: "Re: Lunch plans", text: "Thai again?", messageId: "<lunch-2@remote.example>", inReplyTo: "<lunch-1@remote.example>", references: "<lunch-1@remote.example>" });
    await g.deliver({ to: addr("alice"), subject: "Invoice 42", text: "Attached soon.", messageId: "<inv-42@remote.example>", from: "Billing <billing@shop.example>" });
    await rig.sync.syncNow();

    const page = rig.store.listThreads({ view: "inbox" });
    expect(page.items).toHaveLength(2);
    const lunch = page.items.find((t) => t.subject.includes("Lunch"))!;
    expect(lunch.messageCount).toBe(2);
    expect(lunch.unreadCount).toBe(2);
    expect(rig.sync.status().state).toBe("idle");
    expect(rig.events.some((e) => e.type === "mail_changed")).toBe(true);
    expect(rig.events.some((e) => e.type === "sync" && e.status.state === "syncing")).toBe(true);
    // Bodies of recent inbox mail are prefetched.
    const rows = rig.store.getThreadRows(lunch.id)!;
    expect(rows.messages.every((m) => m.bodyLoaded)).toBe(true);
    expect(rows.messages[0]!.text).toContain("Where shall we eat?");
    await rig.sync.stop();
  });

  it("brings server flag changes down", async () => {
    const rig = makeRig(g, "bob");
    await g.deliver({ to: addr("bob"), subject: "Flag me", text: "x" });
    await rig.sync.syncNow();
    const thread = rig.store.listThreads({ view: "inbox" }).items[0]!;
    expect(thread.unreadCount).toBe(1);
    expect(thread.pinned).toBe(false);

    await rig.server(async (c) => {
      const lock = await c.getMailboxLock("INBOX");
      try { await c.messageFlagsAdd("1:*", ["\\Seen", "\\Flagged"]); } finally { lock.release(); }
    });
    await rig.sync.syncNow();
    const after = rig.store.listThreads({ view: "inbox" }).items[0]!;
    expect(after.unreadCount).toBe(0);
    expect(after.pinned).toBe(true);
  });

  it("removes mail that was expunged on the server", async () => {
    const rig = makeRig(g, "carol");
    await g.deliver({ to: addr("carol"), subject: "Keep" , text: "k" });
    await g.deliver({ to: addr("carol"), subject: "Drop", text: "d" });
    await rig.sync.syncNow();
    expect(rig.store.listThreads({ view: "inbox" }).items).toHaveLength(2);
    await rig.server(async (c) => {
      const lock = await c.getMailboxLock("INBOX");
      try {
        const [uid] = (await c.search({ subject: "Drop" }, { uid: true })) as number[];
        await c.messageDelete(String(uid), { uid: true });
      } finally { lock.release(); }
    });
    await rig.sync.syncNow();
    const items = rig.store.listThreads({ view: "inbox" }).items;
    expect(items.map((t) => t.subject)).toEqual(["Keep"]);
  });

  it("detects new mail while the loop runs and emits new_mail", async () => {
    const rig = makeRig(g, "dave");
    rig.sync.start();
    try {
      await waitFor(() => rig.sync.status().lastSyncAt, "first sync");
      await g.deliver({ to: addr("dave"), subject: "Fresh arrival", text: "hello", from: "Ann <ann@remote.example>" });
      await waitFor(() => rig.store.listThreads({ view: "inbox" }).items.find((t) => t.subject === "Fresh arrival"), "new thread");
      const ev = await waitFor(() => rig.events.find((e) => e.type === "new_mail"), "new_mail event");
      expect(ev).toMatchObject({ type: "new_mail", subject: "Fresh arrival", category: "people" });
    } finally {
      await rig.sync.stop();
    }
  });

  it("wakes on IDLE without waiting for the poll timer", async () => {
    const rig = makeRig(g, "hank", { pollMs: 60_000, idlePollMs: 60_000 });
    rig.sync.start();
    try {
      await waitFor(() => rig.sync.status().lastSyncAt, "first sync");
      await new Promise((r) => setTimeout(r, 1500)); // let the IDLE connection settle
      const started = Date.now();
      await g.deliver({ to: addr("hank"), subject: "Pushed", text: "idle" });
      await waitFor(() => rig.store.listThreads({ view: "inbox" }).items.find((t) => t.subject === "Pushed"), "pushed thread", 8000);
      expect(Date.now() - started).toBeLessThan(8000);
    } finally {
      await rig.sync.stop();
    }
  });

  it("fetches bodies and attachments on demand and caches the attachment", async () => {
    const rig = makeRig(g, "erin");
    const old = new Date(Date.now() - 200 * 24 * 3600 * 1000);
    await g.deliver({
      to: addr("erin"), subject: "Old report", html: "<p>Numbers <b>inside</b></p>", text: "Numbers inside", date: old,
      attachments: [{ filename: "data.csv", content: "a,b\n1,2\n", contentType: "text/csv" }],
    });
    await g.deliver({ to: addr("erin"), subject: "Recent", text: "now" });
    // Window of 365 days so the old message syncs, but only 14 days of bodies are prefetched.
    rig.store.updateSettings({ sync: { initialDays: 365, bodiesForRecentDays: 14 } });
    await rig.sync.syncNow();
    const thread = rig.store.listThreads({ view: "inbox" }).items.find((t) => t.subject === "Old report")!;
    const row = rig.store.getThreadRows(thread.id)!.messages[0]!;
    expect(row.bodyLoaded).toBe(false);
    expect(row.hasAttachments).toBe(true);
    expect(row.attachments).toHaveLength(1);

    await rig.sync.fetchBody(row.id);
    const loaded = rig.store.getThreadRows(thread.id)!.messages[0]!;
    expect(loaded.bodyLoaded).toBe(true);
    expect(loaded.rawHtml).toContain("<b>inside</b>");
    expect(loaded.text).toContain("Numbers inside");

    const att = rig.store.getThreadRows(thread.id)!.messages[0]!.attachments[0]!;
    const bytes = await rig.sync.fetchAttachment(att.id);
    expect(bytes.toString("utf8")).toBe("a,b\n1,2\n");
    const cachedPath = rig.store.getAttachment(att.id)!.cachedPath;
    expect(cachedPath).toContain("data.csv");
    expect((await rig.sync.fetchAttachment(att.id)).equals(bytes)).toBe(true);
  });

  it("reports offline and keeps retrying when the server is unreachable", async () => {
    const rig = makeRig(g, "frank");
    rig.store.updateAccount(rig.account.id, { imapPort: 1 });
    rig.sync.start();
    try {
      await waitFor(() => rig.events.find((e) => e.type === "sync" && e.status.state === "offline"), "offline status");
    } finally {
      await rig.sync.stop();
    }
  });

  it("reports auth_error for a wrong password and stops retrying", async () => {
    const rig = makeRig(g, "gina", { getAuth: async () => ({ user: "gina", pass: "wrong" }) });
    rig.sync.start();
    try {
      const ev = await waitFor(() => rig.events.find((e) => e.type === "sync" && e.status.state === "auth_error"), "auth_error status");
      expect(ev).toBeTruthy();
    } finally {
      await rig.sync.stop();
    }
  });

  it("lists server UIDs through the helper", async () => {
    const rig = makeRig(g, "alice");
    expect((await uidsIn(rig, "INBOX")).length).toBeGreaterThan(0);
  });
});
