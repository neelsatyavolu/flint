import type { FetchMessageObject, ImapFlow } from "imapflow";
import { describe, expect, it } from "vitest";
import { makeStore, msg, seedGmail } from "../store/testkit";
import type { FlintEvent } from "../types";
import { ServerActions } from "./actions";
import type { ImapRunner } from "./runner";
import { AccountSync } from "./sync/accountSync";

// ---------- a scripted Gmail-like server ----------

type FakeMsg = { uid: number; emailId: string; threadId: string; labels: string[]; flags: string[]; subject: string; from: string; to: string; messageId: string; inReplyTo?: string; date: string };
type Box = { path: string; specialUse?: string; uidValidity: number; messages: FakeMsg[] };

class FakeGmail {
  boxes: Box[] = [];
  locks: string[] = [];
  selected: Box | null = null;
  capabilities = new Map<string, boolean | number>([["X-GM-EXT-1", true]]);
  usable = true;
  mailbox: { path: string; uidValidity: bigint; uidNext: number; exists: number } | false = false;
  async connect(): Promise<void> {}
  on(): this { return this; }
  close(): void { this.usable = false; }
  async logout(): Promise<void> { this.usable = false; }
  async list() {
    return this.boxes.map((b) => ({ path: b.path, pathAsListed: b.path, name: b.path.split("/").pop()!, delimiter: "/", parent: [], parentPath: "", flags: new Set<string>(), specialUse: b.specialUse, listed: true, subscribed: true }));
  }
  async getMailboxLock(path: string) {
    const box = this.boxes.find((b) => b.path === path);
    if (!box) throw new Error(`no mailbox ${path}`);
    this.locks.push(path);
    this.selected = box;
    this.mailbox = { path, uidValidity: BigInt(box.uidValidity), uidNext: Math.max(0, ...box.messages.map((m) => m.uid)) + 1, exists: box.messages.length };
    return { path, release: () => undefined };
  }
  #uids(range: string): number[] {
    const all = this.selected!.messages.map((m) => m.uid);
    if (range.includes(",") || !range.includes(":")) return range.split(",").map(Number).filter((u) => all.includes(u));
    const [lo, hi] = range.split(":");
    return all.filter((u) => u >= Number(lo) && (hi === "*" || u <= Number(hi)));
  }
  async search(query: { uid?: string; since?: Date; all?: boolean }): Promise<number[]> {
    if (query.uid) return this.#uids(query.uid);
    return this.selected!.messages.map((m) => m.uid);
  }
  async fetchAll(range: string, q: { envelope?: boolean; labels?: boolean }): Promise<FetchMessageObject[]> {
    return this.#uids(range).map((uid) => {
      const m = this.selected!.messages.find((x) => x.uid === uid)!;
      const out: FetchMessageObject = { seq: uid, uid, flags: new Set(m.flags), emailId: m.emailId, threadId: m.threadId, size: 100 };
      if (q.labels) out.labels = new Set(m.labels);
      if (q.envelope) {
        out.envelope = { subject: m.subject, messageId: `<${m.messageId}>`, ...(m.inReplyTo ? { inReplyTo: `<${m.inReplyTo}>` } : {}), date: new Date(m.date), from: [{ name: "", address: m.from }], to: [{ name: "", address: m.to }] };
        out.internalDate = new Date(m.date);
        out.bodyStructure = { type: "text/plain", encoding: "7bit", parameters: { charset: "utf-8" }, size: 10 };
        out.headers = Buffer.alloc(0);
      }
      return out;
    });
  }
  async fetchOne(range: string, q: { bodyParts?: unknown[]; bodyStructure?: boolean }, opts?: unknown): Promise<FetchMessageObject | false> {
    void opts;
    const uid = Number(range);
    if (q.bodyParts) return { seq: 1, uid, bodyParts: new Map([["1", Buffer.from("Body text")]]) };
    return { seq: 1, uid, bodyStructure: { type: "text/plain", encoding: "7bit", size: 9 } };
  }
}

const asClient = (f: FakeGmail): ImapFlow => f as unknown as ImapFlow;
const msgOf = (over: Partial<FakeMsg> & { uid: number }): FakeMsg => ({
  emailId: String(1000 + over.uid), threadId: "10", labels: [], flags: [], subject: "Roadmap", from: "ann@x.org", to: "me@gmail.com",
  messageId: `g${over.uid}@x.org`, date: "2026-10-20T10:00:00Z", ...over,
});

function gmailServer(): FakeGmail {
  const f = new FakeGmail();
  f.boxes = [
    { path: "INBOX", uidValidity: 1, messages: [] },
    { path: "[Gmail]", uidValidity: 1, messages: [] },
    { path: "[Gmail]/All Mail", specialUse: "\\All", uidValidity: 5, messages: [
      msgOf({ uid: 1, labels: ["\\Inbox", "Work"], flags: [] }),
      msgOf({ uid: 2, labels: ["\\Sent"], flags: ["\\Seen"], from: "me@gmail.com", to: "ann@x.org", subject: "Re: Roadmap", inReplyTo: "g1@x.org", date: "2026-10-20T11:00:00Z" }),
    ] },
    { path: "[Gmail]/Sent Mail", specialUse: "\\Sent", uidValidity: 6, messages: [] },
    { path: "[Gmail]/Drafts", specialUse: "\\Drafts", uidValidity: 7, messages: [] },
    { path: "[Gmail]/Spam", specialUse: "\\Junk", uidValidity: 8, messages: [msgOf({ uid: 1, emailId: "2001", threadId: "20", subject: "Win big", from: "spam@bad.example", labels: ["\\Spam"] })] },
    { path: "[Gmail]/Trash", specialUse: "\\Trash", uidValidity: 9, messages: [] },
    { path: "Work", uidValidity: 10, messages: [] },
  ];
  return f;
}

function gmailSync() {
  const store = makeStore();
  const seed = seedGmail(store, "me@gmail.com");
  store.updateAccount(seed.account.id, { imapHost: "x", username: "me@gmail.com" });
  const server = gmailServer();
  const events: FlintEvent[] = [];
  const sync = new AccountSync({
    store, accountId: seed.account.id, getAuth: async () => ({ user: "me@gmail.com", pass: "x" }), emit: (e) => events.push(e),
    dataDir: "/tmp/flint-test-unused", createClient: () => asClient(server), now: () => Date.parse("2026-10-21T00:00:00Z"),
  });
  return { store, seed, server, sync, events };
}

describe("Gmail sync with a scripted server", () => {
  it("syncs All Mail, Spam and Trash only, and maps labels to folder membership", async () => {
    const { store, seed, server, sync } = gmailSync();
    await sync.syncNow();
    expect([...new Set(server.locks)].sort()).toEqual(["[Gmail]/All Mail", "[Gmail]/Spam", "[Gmail]/Trash"]);

    const inbox = store.listThreads({ view: "inbox" }).items;
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ subject: "Roadmap", messageCount: 1 });
    const work = store.getFolderByPath(seed.account.id, "Work")!;
    expect(store.listThreads({ view: "folder", folderId: work.id }).items).toHaveLength(1);
    expect(store.listThreads({ view: "sent" }).items).toHaveLength(1);
    expect(store.listThreads({ view: "spam" }).items.map((t) => t.subject)).toEqual(["Win big"]);
    // One Gmail thread holds both messages.
    const rows = store.getThreadRows(inbox[0]!.id)!;
    expect(rows.messages.map((m) => m.subject)).toEqual(["Roadmap", "Re: Roadmap"]);
  });

  it("follows label changes and removals on later syncs", async () => {
    const { store, server, sync } = gmailSync();
    await sync.syncNow();
    const allMail = server.boxes.find((b) => b.path === "[Gmail]/All Mail")!;
    allMail.messages[0]!.labels = ["Work"]; // archived on another device
    allMail.messages[0]!.flags = ["\\Seen"];
    await sync.syncNow();
    expect(store.listThreads({ view: "inbox" }).items).toHaveLength(0);
    expect(store.listThreads({ view: "archive" }).items).toHaveLength(1);

    allMail.messages = allMail.messages.filter((m) => m.uid !== 1); // deleted
    await sync.syncNow();
    expect(store.getThreadRows(store.listThreads({ view: "sent" }).items[0]!.id)!.messages).toHaveLength(1);
  });

  it("prefetches bodies for recent inbox mail and stores them", async () => {
    const { store, sync } = gmailSync();
    await sync.syncNow();
    const t = store.listThreads({ view: "inbox" }).items[0]!;
    expect(store.getThreadRows(t.id)!.messages[0]!.bodyLoaded).toBe(true);
    expect(store.getThreadRows(t.id)!.messages[0]!.text).toBe("Body text");
  });
});

// ---------- Gmail server actions ----------

type Call = { method: string; args: unknown[] };
function recordingRunner(): { runner: ImapRunner; calls: Call[] } {
  const calls: Call[] = [];
  const rec = (method: string, ret: unknown) => async (...args: unknown[]) => { calls.push({ method, args }); return ret; };
  const client = {
    getMailboxLock: async (path: string) => { calls.push({ method: "lock", args: [path] }); return { release: () => undefined }; },
    messageFlagsAdd: rec("add", true),
    messageFlagsRemove: rec("remove", true),
    messageMove: async (uids: string, dest: string) => { calls.push({ method: "move", args: [uids, dest] }); return { path: "x", destination: dest, uidMap: new Map(uids.split(",").map((u) => [Number(u), Number(u) + 100])) }; },
    mailboxCreate: rec("create", true),
  } as unknown as ImapFlow;
  return { runner: { run: (fn) => fn(client) }, calls };
}

describe("Gmail server actions", () => {
  function setup() {
    const store = makeStore();
    const seed = seedGmail(store, "me@gmail.com");
    store.ingestMessages(seed.account.id, seed.all.id, [msg({ uid: 5, gmMsgid: "9001", gmThrid: "50", gmLabels: ["INBOX", "[Gmail]/All Mail"] })]);
    const threadId = store.listThreads({ view: "inbox" }).items[0]!.id;
    const { runner, calls } = recordingRunner();
    return { store, seed, threadId, calls, actions: new ServerActions(store, seed.account.id, runner) };
  }

  it("archive removes the Inbox label in All Mail", async () => {
    const { store, threadId, calls, actions } = setup();
    const r = store.moveThreads([threadId], { kind: "archive" });
    expect((await actions.archive(r.locations)).ok).toBe(true);
    expect(calls).toContainEqual({ method: "remove", args: ["5", ["\\Inbox"], { uid: true, useLabels: true }] });
  });

  it("move to inbox adds the Inbox label", async () => {
    const { store, threadId, calls, actions } = setup();
    const a = store.moveThreads([threadId], { kind: "archive" });
    await actions.archive(a.locations);
    const r = store.moveThreads([threadId], { kind: "inbox" });
    expect((await actions.moveToInbox(r.locations)).ok).toBe(true);
    expect(calls).toContainEqual({ method: "add", args: ["5", ["\\Inbox"], { uid: true, useLabels: true }] });
  });

  it("trash moves to the Trash folder and records the new UID", async () => {
    const { store, seed, threadId, calls, actions } = setup();
    const r = store.moveThreads([threadId], { kind: "trash" });
    expect((await actions.trash(r.locations)).ok).toBe(true);
    expect(calls).toContainEqual({ method: "move", args: ["5", "[Gmail]/Trash"] });
    const row = store.getThreadRows(threadId)!.messages[0]!;
    expect(row.folderId).toBe(seed.trash.id);
    expect(row.uid).toBe(105);
  });

  it("moving to a label adds the label and takes the message out of the inbox", async () => {
    const { store, seed, threadId, calls, actions } = setup();
    const label = store.upsertFolder(seed.account.id, { path: "Work" });
    const r = store.moveThreads([threadId], { kind: "folder", folderId: label.id });
    expect((await actions.moveToFolder(r.locations, label.id)).ok).toBe(true);
    expect(calls).toContainEqual({ method: "add", args: ["5", ["Work"], { uid: true, useLabels: true }] });
    expect(calls).toContainEqual({ method: "remove", args: ["5", ["\\Inbox"], { uid: true, useLabels: true }] });
  });

  it("refuses locations from another account", async () => {
    const { store, threadId, seed, runner } = (() => {
      const s = setup();
      return { ...s, runner: recordingRunner().runner };
    })();
    const other = new ServerActions(store, "someone-else", runner);
    const r = store.markRead([threadId], true);
    const rep = await other.setSeen(r.locations, true);
    expect(rep.ok).toBe(false);
    expect(rep.errors[0]!.message).toContain("another account");
    expect(seed.account.id).not.toBe("someone-else");
  });
});
