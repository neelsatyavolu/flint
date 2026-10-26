import { describe, expect, it } from "vitest";
import { DAY, makeStore, me, msg, person, seedGmail, seedImap, T0 } from "./testkit";

const seen = { seen: true, flagged: false, answered: false, draft: false };

describe("ingest: threading", () => {
  it("threads replies by References and In-Reply-To", () => {
    const store = makeStore();
    const s = seedImap(store);
    const out = store.ingestMessages(s.account.id, s.inbox.id, [
      msg({ uid: 1, messageId: "<a@x>", subject: "Lunch?" }),
      msg({ uid: 2, messageId: "<b@x>", inReplyTo: "<a@x>", references: ["<a@x>"], subject: "Re: Lunch?" }),
      msg({ uid: 3, messageId: "<c@x>", inReplyTo: "<b@x>", references: ["<a@x>", "<b@x>"], subject: "Re: Re: Lunch?" }),
    ]);
    expect(new Set(out.map((o) => o.threadId)).size).toBe(1);
    expect(out.map((o) => o.isNew)).toEqual([true, true, true]);
    const t = store.getThreadRows(out[0]!.threadId)!;
    expect(t.subject).toBe("Lunch?");
  });

  it("a reply that arrives before its parent still lands in the same thread", () => {
    const store = makeStore();
    const s = seedImap(store);
    const [reply] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 2, messageId: "r@x", inReplyTo: "p@x", references: ["p@x"], subject: "Re: Plan" })]);
    const [parent] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1, messageId: "p@x", subject: "Plan" })]);
    expect(parent!.threadId).toBe(reply!.threadId);
  });

  it("merges two threads when a later message links them", () => {
    const store = makeStore();
    const s = seedImap(store);
    const [a] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1, messageId: "a@x", subject: "Topic A" })]);
    const [b] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 2, messageId: "b@x", subject: "Other topic", from: [person("Dan")] })]);
    expect(a!.threadId).not.toBe(b!.threadId);
    store.setPinned([b!.threadId], true);
    store.setMuted([a!.threadId], true);
    const [joiner] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 3, messageId: "c@x", inReplyTo: "b@x", references: ["a@x", "b@x"], subject: "Re: both" })]);
    expect(joiner!.mergedThreadIds).toHaveLength(1);
    const rows = store.getThreadRows(joiner!.threadId)!;
    expect(rows.messages).toHaveLength(3);
    expect(rows.pinned).toBe(true);
    expect(rows.muted).toBe(true);
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM threads").get()).toEqual({ n: 1 });
  });

  it("joins by normalized subject within 14 days when participants overlap and no links exist", () => {
    const store = makeStore();
    const s = seedImap(store);
    const [a] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1, messageId: "a@x", subject: "Invoice 12", date: T0 })]);
    const [b] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 2, messageId: null, subject: "Re: Invoice 12", date: T0 + 3 * DAY })]);
    expect(b!.threadId).toBe(a!.threadId);
    const [far] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 3, messageId: "far@x", subject: "Invoice 12", date: T0 + 30 * DAY })]);
    expect(far!.threadId).not.toBe(a!.threadId);
    const [stranger] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 4, messageId: "s@x", subject: "Invoice 12", from: [person("Stranger")], to: [person("Other")], date: T0 + DAY })]);
    expect(stranger!.threadId).not.toBe(a!.threadId);
  });

  it("ignores the user's own address when matching participants", () => {
    const store = makeStore();
    const s = seedImap(store);
    const [a] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1, messageId: "a@x", subject: "Weekly digest", from: [person("One")] })]);
    const [b] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 2, messageId: "b@x", subject: "Weekly digest", from: [person("Two")] })]);
    expect(b!.threadId).not.toBe(a!.threadId);
  });

  it("does not subject-join when the message has a parent link", () => {
    const store = makeStore();
    const s = seedImap(store);
    const [a] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1, messageId: "a@x", subject: "Same subject" })]);
    const [b] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 2, messageId: "b@x", inReplyTo: "unknown@x", subject: "Same subject" })]);
    expect(b!.threadId).not.toBe(a!.threadId);
  });

  it("handles messages with no Message-ID", () => {
    const store = makeStore();
    const s = seedImap(store);
    const [a] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1, messageId: null, subject: "One" })]);
    const [b] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 2, messageId: null, subject: "Two", from: [person("Dan")] })]);
    expect(a!.threadId).not.toBe(b!.threadId);
  });

  it("re-ingesting the same folder/uid updates instead of duplicating", () => {
    const store = makeStore();
    const s = seedImap(store);
    const [first] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1, messageId: "a@x" })]);
    const [again] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1, messageId: "a@x", flags: seen })]);
    expect(again).toMatchObject({ isNew: false, messageRowId: first!.messageRowId, threadId: first!.threadId });
    expect(store.getMessage(first!.messageRowId)!.seen).toBe(true);
  });

  it("adopts a locally moved row instead of duplicating when the server copy shows up", () => {
    const store = makeStore();
    const s = seedImap(store);
    const [o] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1, messageId: "a@x" })]);
    store.moveThreads([o!.threadId], { kind: "archive" });
    const [moved] = store.ingestMessages(s.account.id, s.archive.id, [msg({ uid: 77, messageId: "a@x" })]);
    expect(moved).toMatchObject({ isNew: false, messageRowId: o!.messageRowId });
    expect(store.getMessage(o!.messageRowId)).toMatchObject({ folderId: s.archive.id, uid: 77 });
    expect(store.removeUids(s.inbox.id, [1])).toEqual([]);
    expect(store.getThreadRows(o!.threadId)?.messages).toHaveLength(1);
  });
});

describe("ingest: Gmail", () => {
  it("keys threads by X-GM-THRID and is unique by gm_msgid across folders", () => {
    const store = makeStore();
    const g = seedGmail(store);
    const [a, b] = store.ingestMessages(g.account.id, g.all.id, [
      msg({ uid: 1, gmMsgid: "100", gmThrid: "T1", gmLabels: ["INBOX"], messageId: "x@x" }),
      msg({ uid: 2, gmMsgid: "101", gmThrid: "T1", gmLabels: [], messageId: "y@x" }),
    ]);
    expect(a!.threadId).toBe(b!.threadId);
    expect(store.db.prepare("SELECT thread_key FROM threads").get()).toEqual({ thread_key: "gm:T1" });
    // same message seen again in Trash: update, not duplicate
    const [t] = store.ingestMessages(g.account.id, g.trash.id, [msg({ uid: 9, gmMsgid: "100", gmThrid: "T1", gmLabels: ["[Gmail]/Trash"], messageId: "x@x" })]);
    expect(t).toMatchObject({ isNew: false, messageRowId: a!.messageRowId });
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM messages").get()).toEqual({ n: 2 });
    expect(store.getMessage(a!.messageRowId)).toMatchObject({ folderId: g.trash.id, uid: 9 });
    const members = store.getMessageLocations([a!.messageRowId])[0]!.memberFolderIds;
    expect(members).toEqual([g.trash.id]);
  });

  it("keeps message_folders in sync with labels and creates label folders", () => {
    const store = makeStore();
    const g = seedGmail(store);
    const [o] = store.ingestMessages(g.account.id, g.all.id, [msg({ uid: 1, gmMsgid: "1", gmThrid: "T", gmLabels: ["INBOX", "Receipts"] })]);
    const label = store.getFolderByPath(g.account.id, "Receipts")!;
    expect(label.role).toBeNull();
    expect(store.getMessageLocations([o!.messageRowId])[0]!.memberFolderIds.sort()).toEqual([g.all.id, g.inbox.id, label.id].sort());
    store.applyGmailLabels(g.all.id, [{ uid: 1, labels: ["Receipts"] }]);
    expect(store.getMessageLocations([o!.messageRowId])[0]!.memberFolderIds.sort()).toEqual([g.all.id, label.id].sort());
    expect(store.applyGmailLabels(g.all.id, [{ uid: 1, labels: ["Receipts"] }, { uid: 55, labels: [] }])).toEqual([]);
    expect(store.listFolders(g.account.id).find((f) => f.path === "Receipts")).toMatchObject({ total: 1 });
  });

  it("omitting gmLabels on update leaves label membership alone", () => {
    const store = makeStore();
    const g = seedGmail(store);
    const [o] = store.ingestMessages(g.account.id, g.all.id, [msg({ uid: 1, gmMsgid: "1", gmThrid: "T", gmLabels: ["INBOX"] })]);
    store.ingestMessages(g.account.id, g.all.id, [msg({ uid: 1, gmMsgid: "1", gmThrid: "T", flags: seen })]);
    expect(store.getMessageLocations([o!.messageRowId])[0]!.memberFolderIds).toContain(g.inbox.id);
  });
});

describe("ingest: contacts, categories, blocked, rules", () => {
  it("counts received for senders and sent for recipients of the user's own mail", () => {
    const store = makeStore();
    const s = seedImap(store);
    store.updateAccount(s.account.id, { aliases: ["alias@example.com"] });
    store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1, from: [person("Carla", "Carla@Example.org")] }), msg({ uid: 2, from: [person("Carla", "carla@example.org")] })]);
    store.ingestMessages(s.account.id, s.sent.id, [
      msg({ uid: 1, from: [{ name: "Me", address: "alias@example.com" }], to: [person("Bob")], cc: [person("Cy")], bcc: [me()] }),
    ]);
    const rows = store.db.prepare("SELECT email, sent_count, received_count FROM contacts ORDER BY email").all();
    expect(rows).toEqual([
      { email: "bob@example.org", sent_count: 1, received_count: 0 },
      { email: "carla@example.org", sent_count: 0, received_count: 2 },
      { email: "cy@example.org", sent_count: 1, received_count: 0 },
    ]);
    // updating an existing message does not double count
    store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1, from: [person("Carla", "carla@example.org")], flags: seen })]);
    expect(store.db.prepare("SELECT received_count FROM contacts WHERE email = 'carla@example.org'").get()).toEqual({ received_count: 2 });
  });

  it("suggests contacts by prefix ranked by sent*3+received", () => {
    const store = makeStore();
    const s = seedImap(store);
    store.ingestMessages(s.account.id, s.inbox.id, [
      msg({ uid: 1, from: [person("Alice Smith", "alice@x.com")] }), msg({ uid: 2, from: [person("Alan", "alan@x.com")] }), msg({ uid: 3, from: [person("Alan", "alan@x.com")] }),
      msg({ uid: 4, from: [person("Bob Allen", "bob@x.com")] }),
    ]);
    store.ingestMessages(s.account.id, s.sent.id, [msg({ uid: 1, from: [me()], to: [person("Alice Smith", "alice@x.com")] })]);
    expect(store.suggestContacts("al").map((c) => c.email)).toEqual(["alice@x.com", "alan@x.com", "bob@x.com"]);
    expect(store.suggestContacts("alice@")[0]).toMatchObject({ email: "alice@x.com", score: 4 });
    expect(store.suggestContacts("")).toEqual([]);
    expect(store.suggestContacts("100%")).toEqual([]);
    expect(store.suggestContacts("al", 1)).toHaveLength(1);
  });

  it("categorizes with contacts, list headers and automated senders", () => {
    const store = makeStore();
    const s = seedImap(store);
    store.ingestMessages(s.account.id, s.sent.id, [msg({ uid: 1, from: [me()], to: [person("News", "news@brand.com")] })]);
    const out = store.ingestMessages(s.account.id, s.inbox.id, [
      msg({ uid: 1, subject: "s1", from: [person("Pal")] }),
      msg({ uid: 2, subject: "s2", from: [person("Brand", "deals@brand.com")], headers: { "list-unsubscribe": "<mailto:u@brand.com>" } }),
      msg({ uid: 3, subject: "s3", from: [person("GitHub", "noreply@github.com")] }),
      msg({ uid: 4, subject: "s4", from: [person("News", "news@brand.com")], headers: { "list-id": "<n.brand.com>" } }),
    ]);
    expect(out.map((o) => o.category)).toEqual(["people", "newsletters", "notifications", "people"]);
    expect(out.map((o) => o.fromMe)).toEqual([false, false, false, false]);
    expect(store.getThreadRows(out[1]!.threadId)!.category).toBe("newsletters");
  });

  it("flags blocked senders and keeps them out of the inbox view", () => {
    const store = makeStore();
    const s = seedImap(store);
    expect(store.blockSender("Evil.org")).toBe("@evil.org");
    expect(store.blockSender("spam@x.com")).toBe("spam@x.com");
    const out = store.ingestMessages(s.account.id, s.inbox.id, [
      msg({ uid: 1, from: [person("A", "a@evil.org")] }), msg({ uid: 2, from: [person("S", "spam@x.com")] }), msg({ uid: 3, from: [person("Ok", "ok@x.com")] }),
    ]);
    expect(out.map((o) => o.blocked)).toEqual([true, true, false]);
    expect(store.listThreads({ view: "inbox" }).items).toHaveLength(1);
    expect(() => store.blockSender("nonsense")).toThrowError(/email address or a domain/);
    expect(store.listBlocked().map((b) => b.pattern).sort()).toEqual(["@evil.org", "spam@x.com"]);
    expect(store.unblockSender("evil.org")).toBe("@evil.org");
    expect(store.unblockSender("evil.org")).toBeNull();
  });

  it("evaluates rules for new inbox mail, applies category and mute, returns the rest", () => {
    const store = makeStore();
    const s = seedImap(store);
    store.saveRule({ name: "Receipts", enabled: true, accountId: null, match: "all", sortOrder: 1, conditions: [{ field: "from", op: "contains", value: "stripe" }], actions: [{ type: "category", category: "notifications" }, { type: "mark_read" }, { type: "archive" }, { type: "mute" }] });
    store.saveRule({ name: "Off", enabled: false, accountId: null, match: "all", sortOrder: 2, conditions: [{ field: "subject", op: "contains", value: "hi" }], actions: [{ type: "trash" }] });
    const [hit, miss] = store.ingestMessages(s.account.id, s.inbox.id, [
      msg({ uid: 1, subject: "Receipt", from: [person("Stripe", "billing@stripe.com")] }), msg({ uid: 2, subject: "Lunch", from: [person("Pal")] }),
    ]);
    expect(hit!.ruleActions.map((a) => a.type)).toEqual(["category", "mark_read", "archive", "mute"]);
    expect(hit!.category).toBe("notifications");
    expect(store.getThreadRows(hit!.threadId)).toMatchObject({ category: "notifications", muted: true });
    expect(miss!.ruleActions).toEqual([]);
    // not re-run on updates, skipped for backfill and for non-inbox folders
    const [again] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1, from: [person("Stripe", "billing@stripe.com")] })]);
    expect(again!.ruleActions).toEqual([]);
    const [back] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 3, from: [person("Stripe", "billing@stripe.com")] })], { evaluate: false });
    expect(back).toMatchObject({ ruleActions: [], blocked: false });
    const [trash] = store.ingestMessages(s.account.id, s.trash.id, [msg({ uid: 1, from: [person("Stripe", "billing@stripe.com")] })]);
    expect(trash!.ruleActions).toEqual([]);
  });

  it("validates rules and supports update and delete", () => {
    const store = makeStore();
    expect(() => store.saveRule({ name: "", enabled: true, accountId: null, match: "all", sortOrder: 0, conditions: [], actions: [] })).toThrowError(/not valid/);
    const r = store.saveRule({ name: "A", enabled: true, accountId: null, match: "any", sortOrder: 0, conditions: [{ field: "subject", op: "contains", value: "x" }], actions: [{ type: "pin" }] });
    expect(store.saveRule({ ...r, name: "B" }).name).toBe("B");
    expect(() => store.saveRule({ ...r, id: 999 })).toThrowError(/no longer exists/);
    expect(store.listRules()).toHaveLength(1);
    store.deleteRule(r.id);
    expect(store.listRules()).toEqual([]);
  });
});

describe("ingest: search index and bodies", () => {
  it("indexes subject, sender, recipients and body (html stripped, capped)", () => {
    const store = makeStore();
    const s = seedImap(store);
    store.ingestMessages(s.account.id, s.inbox.id, [
      msg({ uid: 1, subject: "Quarterly plan", from: [person("Zelda Fitz", "zelda@x.com")], htmlBody: "<div>Budget <b>approved</b> for <a href='http://t.example/track'>team</a></div>" }),
      msg({ uid: 2, subject: "Other", textBody: "x".repeat(150_000) + " needle" }),
    ]);
    const hit = (q: string) => store.listThreads({ view: "search", search: q }).items.length;
    expect(hit("quarterly")).toBe(1);
    expect(hit("zelda")).toBe(1);
    expect(hit("approved")).toBe(1);
    expect(hit("t.example")).toBe(0);
    expect(hit("needle")).toBe(0);
    expect(hit("me@example.com")).toBe(2);
  });

  it("returns an outcome per message with ids", () => {
    const store = makeStore();
    const s = seedImap(store);
    const out = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 4 }), msg({ uid: 5, from: [me()], to: [person("Bob")] })]);
    expect(out.map((o) => o.uid)).toEqual([4, 5]);
    expect(out[1]!.fromMe).toBe(true);
    expect(out[1]!.category).toBe("people");
    expect(store.ingestMessages(s.account.id, s.inbox.id, [])).toEqual([]);
  });

  it("rejects a folder from another account", () => {
    const store = makeStore();
    const a = seedImap(store);
    const b = seedImap(store, "other@example.com");
    expect(() => store.ingestMessages(a.account.id, b.inbox.id, [msg({ uid: 1 })])).toThrowError(/different account/);
  });

  it("rolls back the whole batch when one message fails", () => {
    const store = makeStore();
    const s = seedImap(store);
    const bad = msg({ uid: 2 });
    (bad as { from: unknown }).from = null;
    expect(() => store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1 }), bad])).toThrow();
    expect(store.listLocalUids(s.inbox.id)).toEqual([]);
  });
});

describe("getThreadRows: one message per Message-ID", () => {
  it("shows a message once when the server keeps several copies of it", () => {
    const store = makeStore();
    const s = seedImap(store);
    const [orig] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1, messageId: "q@x", subject: "Trip" })]);
    const reply = { messageId: "r@x", inReplyTo: "q@x", references: ["q@x"], subject: "Re: Trip", from: [me()], flags: seen };
    // A tracked send through Proton Bridge: one saved copy per envelope recipient, plus Flint's clean copy with everyone.
    store.ingestMessages(s.account.id, s.sent.id, [
      msg({ uid: 637, ...reply, to: [person("Guest Relations")] }),
      msg({ uid: 638, ...reply, to: [person("Group")] }),
      msg({ uid: 639, ...reply, to: [person("Guest Relations"), person("Group")] }),
    ]);
    const rows = store.getThreadRows(orig!.threadId)!;
    expect(rows.messages.map((m) => m.messageId)).toEqual(["q@x", "r@x"]);
    expect(rows.messages[1]!.to).toHaveLength(2);
    expect(rows.messages[1]!.inSent).toBe(true);
  });
});
