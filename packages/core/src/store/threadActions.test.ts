import { describe, expect, it } from "vitest";
import { FlintError } from "../types";
import { DAY, makeStore, me, msg, person, seedGmail, seedImap, T0 } from "./testkit";

const seenFlags = { seen: true, flagged: false, answered: false, draft: false };

function thread() {
  const store = makeStore();
  const s = seedImap(store);
  const out = store.ingestMessages(s.account.id, s.inbox.id, [
    msg({ uid: 1, messageId: "a@x", subject: "Plan", date: T0 }),
    msg({ uid: 2, messageId: "b@x", references: ["a@x"], subject: "Re: Plan", date: T0 + 1000, flags: seenFlags }),
  ]);
  return { store, s, threadId: out[0]!.threadId };
}

describe("markRead / setPinned / muted", () => {
  it("marks every message read and returns the changed locations", () => {
    const { store, threadId } = thread();
    const r = store.markRead([threadId], true);
    expect(r.locations.map((l) => l.uid)).toEqual([1]);
    expect(store.listThreads({ view: "inbox" }).items[0]!.unreadCount).toBe(0);
    expect(store.markRead([threadId], true).locations).toEqual([]);
    const un = store.markRead([threadId], false);
    expect(un.locations.map((l) => l.uid).sort()).toEqual([1, 2]);
  });

  it("pins by flagging all messages and reports them for IMAP", () => {
    const { store, threadId } = thread();
    const r = store.setPinned([threadId], true);
    expect(r.locations).toHaveLength(2);
    expect(r.locations.every((l) => l.flagged)).toBe(true);
    expect(store.getThreadRows(threadId)!.pinned).toBe(true);
    expect(store.listThreads({ view: "pinned" }).items).toHaveLength(1);
    store.setPinned([threadId], false);
    expect(store.getThreadRows(threadId)!.pinned).toBe(false);
    expect(store.listThreads({ view: "pinned" }).items).toEqual([]);
  });

  it("mutes and snoozes without server locations", () => {
    const { store, threadId } = thread();
    expect(store.setMuted([threadId], true).locations).toEqual([]);
    expect(store.getThreadRows(threadId)!.muted).toBe(true);
    store.snooze([threadId], T0 + DAY);
    expect(store.getThreadRows(threadId)!.snoozedUntil).toBe(T0 + DAY);
    store.unsnooze([threadId]);
    expect(store.getThreadRows(threadId)!.snoozedUntil).toBeNull();
  });
});

describe("snapshots", () => {
  it("restores flags, thread state and membership after changes", () => {
    const { store, s, threadId } = thread();
    const snap = JSON.parse(JSON.stringify(store.snapshotThreads([threadId])));
    store.markRead([threadId], true);
    store.setPinned([threadId], true);
    store.setMuted([threadId], true);
    store.snooze([threadId], T0 + DAY);
    store.moveThreads([threadId], { kind: "trash" });
    expect(store.listThreads({ view: "trash" }).items).toHaveLength(1);
    expect(store.restoreSnapshot(snap)).toEqual([threadId]);
    store.transaction(() => undefined);
    const rows = store.getThreadRows(threadId)!;
    expect(rows).toMatchObject({ pinned: false, muted: false, snoozedUntil: null });
    expect(rows.messages.map((m) => m.seen)).toEqual([false, true]);
    expect(store.listThreads({ view: "trash" }).items).toEqual([]);
    expect(store.listThreads({ view: "inbox" }).items).toHaveLength(1);
    expect(store.getMessageLocations([rows.messages[0]!.id])[0]!.memberFolderIds).toEqual([s.inbox.id]);
  });

  it("ignores threads that no longer exist", () => {
    const { store } = thread();
    expect(store.restoreSnapshot({ version: 1, threads: [{ id: 9999, pinned: true, muted: false, snoozedUntil: null, resurfacedAt: null, messages: [] }] })).toEqual([]);
  });
});

describe("moveThreads (generic IMAP)", () => {
  it("archive, trash, spam, inbox and folder", () => {
    const { store, s, threadId } = thread();
    const proj = store.upsertFolder(s.account.id, { path: "Projects" });
    const view = (v: "inbox" | "archive" | "trash" | "spam" | "folder", folderId?: number) => store.listThreads({ view: v, folderId }).items.length;
    store.moveThreads([threadId], { kind: "archive" });
    expect([view("inbox"), view("archive")]).toEqual([0, 1]);
    store.moveThreads([threadId], { kind: "trash" });
    expect([view("archive"), view("trash")]).toEqual([0, 1]);
    store.moveThreads([threadId], { kind: "spam" });
    expect([view("trash"), view("spam")]).toEqual([0, 1]);
    store.moveThreads([threadId], { kind: "inbox" });
    expect([view("spam"), view("inbox")]).toEqual([0, 1]);
    store.moveThreads([threadId], { kind: "folder", folderId: proj.id });
    expect([view("inbox"), view("folder", proj.id)]).toEqual([0, 1]);
  });

  it("archive creates the Archive folder when missing and keeps sent mail in Sent", () => {
    const store = makeStore();
    const a = store.createAccount({ email: "x@x.com", provider: "imap", authKind: "password", imapHost: "i", imapPort: 1, imapSecure: true, smtpHost: "s", smtpPort: 1, smtpSecure: true, username: "x" });
    const inbox = store.upsertFolder(a.id, { path: "INBOX", role: "inbox" });
    const sent = store.upsertFolder(a.id, { path: "Sent", role: "sent" });
    const [m1] = store.ingestMessages(a.id, inbox.id, [msg({ uid: 1, messageId: "a@x" })]);
    store.ingestMessages(a.id, sent.id, [msg({ uid: 1, messageId: "b@x", references: ["a@x"], from: [{ name: "X", address: "x@x.com" }], to: [person("Bo")] })]);
    const r = store.moveThreads([m1!.threadId], { kind: "archive" });
    expect(r.locations).toHaveLength(1);
    expect(store.getFolderByRole(a.id, "archive")).not.toBeNull();
    expect(store.listThreads({ view: "sent" }).items).toHaveLength(1);
  });

  it("throws a friendly error when the trash folder is missing", () => {
    const store = makeStore();
    const a = store.createAccount({ email: "x@x.com", provider: "imap", authKind: "password", imapHost: "i", imapPort: 1, imapSecure: true, smtpHost: "s", smtpPort: 1, smtpSecure: true, username: "x" });
    const inbox = store.upsertFolder(a.id, { path: "INBOX", role: "inbox" });
    const [o] = store.ingestMessages(a.id, inbox.id, [msg({ uid: 1 })]);
    expect(() => store.moveThreads([o!.threadId], { kind: "trash" })).toThrowError(FlintError);
    expect(store.listThreads({ view: "inbox" }).items).toHaveLength(1);
  });

  it("relocateMessage records the server's new UID", () => {
    const { store, s, threadId } = thread();
    const [first] = store.getThreadLocations([threadId]);
    store.relocateMessage(first!.messageRowId, s.archive.id, 42);
    expect(store.findByFolderUid(s.archive.id, 42)?.id).toBe(first!.messageRowId);
    expect(store.listLocalUids(s.inbox.id)).toEqual([2]);
  });
});

describe("moveThreads (Gmail)", () => {
  it("trash replaces membership, inbox restores it, folder adds a label and drops the inbox", () => {
    const store = makeStore();
    const g = seedGmail(store);
    const [o] = store.ingestMessages(g.account.id, g.all.id, [
      msg({ uid: 1, gmMsgid: "1", gmThrid: "T", gmLabels: ["INBOX"] }),
      msg({ uid: 2, gmMsgid: "2", gmThrid: "T", from: [me()], to: [person("Bo")], gmLabels: ["[Gmail]/Sent Mail"] }),
    ]);
    const label = store.upsertFolder(g.account.id, { path: "Receipts" });
    const ids = () => store.getThreadLocations([o!.threadId]).map((l) => l.memberFolderIds.sort());
    store.moveThreads([o!.threadId], { kind: "folder", folderId: label.id });
    expect(ids()).toEqual([[g.all.id, label.id].sort(), [g.all.id, g.sent.id].sort()]);
    store.moveThreads([o!.threadId], { kind: "trash" });
    expect(ids()).toEqual([[g.trash.id], [g.trash.id]]);
    store.moveThreads([o!.threadId], { kind: "inbox" });
    expect(ids()[0]).toEqual([g.all.id, g.inbox.id].sort());
    expect(store.listThreads({ view: "inbox" }).items).toHaveLength(1);
    store.moveThreads([o!.threadId], { kind: "spam" });
    expect(store.listThreads({ view: "spam" }).items).toHaveLength(1);
  });
});

describe("wakeSnoozed", () => {
  it("marks the latest message unread and sets resurfaced_at", () => {
    const { store, threadId } = thread();
    store.markRead([threadId], true);
    store.snooze([threadId], T0 + DAY);
    const r = store.wakeSnoozed(threadId, T0 + 2 * DAY);
    expect(r.locations.map((l) => l.uid)).toEqual([2]);
    expect(store.getThreadRows(threadId)).toMatchObject({ snoozedUntil: null, resurfacedAt: T0 + 2 * DAY });
    expect(store.getThreadRows(threadId)!.messages.map((m) => m.seen)).toEqual([true, false]);
    store.resurface(threadId, T0 + 3 * DAY);
    expect(store.getThreadRows(threadId)!.resurfacedAt).toBe(T0 + 3 * DAY);
  });
});
