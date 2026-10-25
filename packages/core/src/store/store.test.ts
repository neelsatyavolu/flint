import { describe, expect, it } from "vitest";
import { FlintError } from "../types";
import { makeStore, msg, person, seedGmail, seedImap, T0 } from "./testkit";

describe("accounts", () => {
  it("creates, reads, updates, lists and deletes", () => {
    const store = makeStore();
    const a = store.createAccount({ email: "A@X.com", provider: "imap", authKind: "password", imapHost: "i", imapPort: 993, imapSecure: true, smtpHost: "s", smtpPort: 465, smtpSecure: true, username: "a", aliases: ["Alias@X.com"] });
    expect(a.email).toBe("a@x.com");
    expect(a.aliases).toEqual(["alias@x.com"]);
    expect(a.enabled).toBe(true);
    expect(store.getAccount(a.id)).toEqual(a);
    expect(store.getAccountByEmail("A@x.com")?.id).toBe(a.id);
    const b = store.createAccount({ email: "b@x.com", provider: "gmail", authKind: "oauth_google", imapHost: "i", imapPort: 993, imapSecure: true, smtpHost: "s", smtpPort: 465, smtpSecure: true, username: "b" });
    expect(b.sortOrder).toBe(1);
    const u = store.updateAccount(a.id, { name: "Ann", color: "#fff", enabled: false, aliases: ["z@x.com"], sortOrder: 5 });
    expect(u).toMatchObject({ name: "Ann", color: "#fff", enabled: false, aliases: ["z@x.com"], sortOrder: 5 });
    expect(store.listAccounts().map((x) => x.id)).toEqual([b.id, a.id]);
    expect([...store.ownAddresses()].sort()).toEqual(["a@x.com", "b@x.com", "z@x.com"]);
    store.deleteAccount(a.id);
    expect(store.getAccount(a.id)).toBeNull();
  });

  it("rejects duplicates and unknown ids with FlintError", () => {
    const store = makeStore();
    seedImap(store);
    expect(() => seedImap(store)).toThrowError(FlintError);
    expect(() => store.updateAccount("nope", { name: "x" })).toThrowError(/no longer exists/);
  });

  it("deleting an account removes mail and search rows", () => {
    const store = makeStore();
    const s = seedImap(store);
    store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1, subject: "findme", textBody: "alpha" })]);
    store.deleteAccount(s.account.id);
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM messages").get()).toEqual({ n: 0 });
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM threads").get()).toEqual({ n: 0 });
    expect(store.db.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'alpha'").all()).toEqual([]);
  });
});

describe("folders", () => {
  it("upserts by path, keeps role, counts unread and total", () => {
    const store = makeStore();
    const s = seedImap(store);
    const again = store.upsertFolder(s.account.id, { path: "INBOX", name: "Inbox" });
    expect(again.id).toBe(s.inbox.id);
    expect(again.role).toBe("inbox");
    expect(store.getFolderByRole(s.account.id, "sent")?.id).toBe(s.sent.id);
    expect(store.getFolderByRole(s.account.id, "all")).toBeNull();
    store.ingestMessages(s.account.id, s.inbox.id, [
      msg({ uid: 1 }), msg({ uid: 2, flags: { seen: true, flagged: false, answered: false, draft: false } }),
    ]);
    const inbox = store.listFolders(s.account.id).find((f) => f.path === "INBOX")!;
    expect(inbox).toMatchObject({ unread: 1, total: 2, name: "Inbox" });
  });

  it("stores and returns sync state", () => {
    const store = makeStore();
    const s = seedImap(store);
    expect(store.getFolderSyncState(s.inbox.id)).toEqual({ uidValidity: null, uidNext: null, highestModseq: null, syncedMinUid: null, lastSyncAt: null });
    store.setFolderSyncState(s.inbox.id, { uidValidity: 7, uidNext: 100, highestModseq: "123456789012", syncedMinUid: 5, lastSyncAt: 9 });
    store.setFolderSyncState(s.inbox.id, { uidNext: 101 });
    expect(store.getFolderSyncState(s.inbox.id)).toEqual({ uidValidity: 7, uidNext: 101, highestModseq: "123456789012", syncedMinUid: 5, lastSyncAt: 9 });
    expect(() => store.getFolderSyncState(9999)).toThrowError(FlintError);
  });

  it("resetFolder deletes the folder's messages and sync state", () => {
    const store = makeStore();
    const s = seedImap(store);
    store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1, subject: "gone", textBody: "zebra" })]);
    store.ingestMessages(s.account.id, s.sent.id, [msg({ uid: 1, subject: "stays", from: [{ name: "Me", address: "me@example.com" }], to: [person("Bob")] })]);
    store.setFolderSyncState(s.inbox.id, { uidValidity: 1, uidNext: 2 });
    const threads = store.resetFolder(s.inbox.id);
    expect(threads).toHaveLength(1);
    expect(store.listLocalUids(s.inbox.id)).toEqual([]);
    expect(store.listLocalUids(s.sent.id)).toEqual([1]);
    expect(store.getFolderSyncState(s.inbox.id).uidValidity).toBeNull();
    expect(store.db.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'zebra'").all()).toEqual([]);
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM threads").get()).toEqual({ n: 1 });
  });

  it("ensureFolderByRole creates archive but not unknown trash roles for missing folders", () => {
    const store = makeStore();
    const a = store.createAccount({ email: "x@x.com", provider: "imap", authKind: "password", imapHost: "i", imapPort: 1, imapSecure: true, smtpHost: "s", smtpPort: 1, smtpSecure: true, username: "x" });
    expect(store.ensureFolderByRole(a.id, "archive")).toMatchObject({ path: "Archive", role: "archive" });
    expect(store.ensureFolderByRole(a.id, "archive").id).toBe(store.getFolderByRole(a.id, "archive")!.id);
    expect(() => store.ensureFolderByRole(a.id, "all")).toThrowError(FlintError);
  });
});

describe("message lookups and flags", () => {
  it("finds by id, Message-ID and folder/uid, and updates flags", () => {
    const store = makeStore();
    const s = seedImap(store);
    const [o] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 5, messageId: "<abc@x>", subject: "Hi", textBody: "body text" })]);
    const m = store.getMessage(o!.messageRowId)!;
    expect(m).toMatchObject({ uid: 5, messageId: "abc@x", bodyLoaded: true, text: "body text", seen: false });
    expect(store.findByMessageId(s.account.id, "<abc@x>")).toHaveLength(1);
    expect(store.findByFolderUid(s.inbox.id, 5)?.id).toBe(m.id);
    expect(store.findByFolderUid(s.inbox.id, 6)).toBeNull();
    const changed = store.applyFlags(s.inbox.id, [{ uid: 5, seen: true, flagged: true }, { uid: 99, seen: true }]);
    expect(changed).toEqual([m.threadId]);
    expect(store.getMessage(m.id)).toMatchObject({ seen: true, flagged: true });
    expect(store.getThreadRows(m.threadId)?.pinned).toBe(true);
    expect(store.applyFlags(s.inbox.id, [{ uid: 5, seen: true }])).toEqual([]);
    store.applyFlags(s.inbox.id, [{ uid: 5, flagged: false }]);
    expect(store.getThreadRows(m.threadId)?.pinned).toBe(false);
  });

  it("removeUids deletes messages, search rows and empty threads", () => {
    const store = makeStore();
    const s = seedImap(store);
    store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1, subject: "one", textBody: "quokka" }), msg({ uid: 2, subject: "two" })]);
    expect(store.listLocalUids(s.inbox.id)).toEqual([1, 2]);
    expect(store.listLocalUids(s.inbox.id, 2)).toEqual([2]);
    const threads = store.removeUids(s.inbox.id, [1]);
    expect(threads).toHaveLength(1);
    expect(store.listLocalUids(s.inbox.id)).toEqual([2]);
    expect(store.db.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'quokka'").all()).toEqual([]);
    expect(store.removeUids(s.inbox.id, [])).toEqual([]);
  });

  it("setBody stores bodies, attachments, snippet and refreshes the index", () => {
    const store = makeStore();
    const s = seedImap(store);
    const [o] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1, subject: "Plan" })]);
    expect(store.getMessage(o!.messageRowId)).toMatchObject({ bodyLoaded: false, snippet: "" });
    store.setBody(o!.messageRowId, {
      text: null, html: "<p>Budget <b>numbers</b></p><style>.x{color:red}</style>",
      attachments: [{ part: "2", filename: "a.pdf", contentType: "application/pdf", size: 10, contentId: null, inline: false }, { part: "3", filename: "i.png", contentType: "image/png", size: 5, contentId: "cid1", inline: true }],
    });
    const m = store.getMessage(o!.messageRowId)!;
    expect(m).toMatchObject({ bodyLoaded: true, hasAttachments: true });
    expect(m.snippet).toBe("Budget numbers");
    const rows = store.getThreadRows(m.threadId)!;
    expect(rows.messages[0]!.attachments.map((a) => [a.filename, a.inline])).toEqual([["a.pdf", false], ["i.png", true]]);
    expect(store.listThreads({ view: "search", search: "numbers" }).items).toHaveLength(1);
    expect(store.listThreads({ view: "search", search: "color" }).items).toHaveLength(0);
    expect(() => store.setBody(9999, { text: "x", html: null })).toThrowError(FlintError);
    expect(store.getAttachment(rows.messages[0]!.attachments[0]!.id)?.part).toBe("2");
    store.setAttachmentCachedPath(rows.messages[0]!.attachments[0]!.id, "/tmp/x");
    expect(store.getAttachment(rows.messages[0]!.attachments[0]!.id)?.cachedPath).toBe("/tmp/x");
  });

  it("getThreadRows returns oldest first with unsubscribe info and isFromMe", () => {
    const store = makeStore();
    const s = seedImap(store);
    const out = store.ingestMessages(s.account.id, s.inbox.id, [
      msg({ uid: 2, messageId: "b@x", inReplyTo: "a@x", references: ["a@x"], date: T0 + 2000, from: [{ name: "Me", address: "me@example.com" }], to: [person("Carla")] }),
      msg({ uid: 1, messageId: "a@x", date: T0, headers: { "list-unsubscribe": "<https://u.example/x>, <mailto:u@example.org>", "list-unsubscribe-post": "List-Unsubscribe=One-Click" } }),
    ]);
    expect(out[0]!.threadId).toBe(out[1]!.threadId);
    const rows = store.getThreadRows(out[0]!.threadId)!;
    expect(rows.messages.map((m) => m.uid)).toEqual([1, 2]);
    expect(rows.messages.map((m) => m.isFromMe)).toEqual([false, true]);
    expect(rows.messages[0]!.unsubscribe).toEqual({ url: "https://u.example/x", mailto: "mailto:u@example.org", oneClick: true });
    expect(rows.messages[1]!.unsubscribe).toBeNull();
    expect(store.getThreadRows(9999)).toBeNull();
  });

  it("returns thread locations with membership for IMAP actions", () => {
    const store = makeStore();
    const g = seedGmail(store);
    const [o] = store.ingestMessages(g.account.id, g.all.id, [msg({ uid: 10, gmMsgid: "1", gmThrid: "t1", gmLabels: ["INBOX", "[Gmail]/Sent Mail"] })]);
    const [loc] = store.getThreadLocations([o!.threadId]);
    expect(loc).toMatchObject({ provider: "gmail", folderPath: "[Gmail]/All Mail", folderRole: "all", uid: 10, gmMsgid: "1" });
    expect(loc!.memberFolderIds.sort()).toEqual([g.all.id, g.inbox.id, g.sent.id].sort());
    expect(store.getMessageLocations([o!.messageRowId])).toHaveLength(1);
  });
});
