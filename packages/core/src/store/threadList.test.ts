import { describe, expect, it } from "vitest";
import { FlintError } from "../types";
import { DAY, makeStore, me, msg, person, seedGmail, seedImap, T0 } from "./testkit";

const seenFlags = { seen: true, flagged: false, answered: false, draft: false };
const unseen = { seen: false, flagged: false, answered: false, draft: false };

function fixture() {
  const store = makeStore();
  const s = seedImap(store);
  const ing = (folder: number, ...m: Parameters<typeof msg>[0][]) => store.ingestMessages(s.account.id, folder, m.map(msg));
  return { store, s, ing };
}

describe("listThreads: inbox", () => {
  it("returns ThreadListItem fields", () => {
    const { store, s, ing } = fixture();
    ing(s.inbox.id,
      { uid: 1, messageId: "a@x", subject: "Plan", from: [person("Carla")], date: T0, snippet: "first", hasAttachments: true },
      { uid: 2, messageId: "b@x", inReplyTo: "a@x", references: ["a@x"], subject: "Re: Plan", from: [me()], to: [person("Carla")], date: T0 + 1000, snippet: "my reply", flags: seenFlags },
      { uid: 3, messageId: "c@x", inReplyTo: "b@x", references: ["a@x", "b@x"], subject: "Re: Plan", from: [person("Dan")], date: T0 + 2000, snippet: "latest" },
    );
    const page = store.listThreads({ view: "inbox" });
    expect(page.nextCursor).toBeNull();
    expect(page.bundles).toEqual([]);
    const item = page.items[0]!;
    expect(page.items).toHaveLength(1);
    expect(item).toMatchObject({
      accountId: s.account.id, subject: "Plan", snippet: "latest", messageCount: 3, unreadCount: 2, hasAttachments: true,
      pinned: false, muted: false, snoozedUntil: null, category: "people", hasDraft: false, receipt: null, lastDate: T0 + 2000,
    });
    expect(item.participants.map((p) => p.name)).toEqual(["Carla", "me", "Dan"]);
  });

  it("moves a repeated sender to the end of participants", () => {
    const { store, s, ing } = fixture();
    ing(s.inbox.id,
      { uid: 1, messageId: "a@x", from: [person("Carla")], date: T0 },
      { uid: 2, messageId: "b@x", references: ["a@x"], from: [person("Dan")], date: T0 + 1 },
      { uid: 3, messageId: "c@x", references: ["a@x"], from: [person("Carla")], date: T0 + 2 },
    );
    expect(store.listThreads({ view: "inbox" }).items[0]!.participants.map((p) => p.name)).toEqual(["Dan", "Carla"]);
  });

  it("hides snoozed threads until they wake, then sorts by resurfaced_at", () => {
    const { store, s, ing } = fixture();
    const [a, b] = ing(s.inbox.id, { uid: 1, subject: "old", from: [person("Al")], date: T0 }, { uid: 2, subject: "new", from: [person("Bo")], date: T0 + DAY });
    store.snooze([a!.threadId], T0 + 5 * DAY);
    expect(store.listThreads({ view: "inbox" }, T0 + 2 * DAY).items.map((i) => i.id)).toEqual([b!.threadId]);
    expect(store.listThreads({ view: "snoozed" }, T0 + 2 * DAY).items.map((i) => i.id)).toEqual([a!.threadId]);
    expect(store.listThreads({ view: "inbox" }, T0 + 6 * DAY).items.map((i) => i.id)).toEqual([b!.threadId, a!.threadId]);
    expect(store.listDueSnoozes(T0 + 6 * DAY)).toEqual([a!.threadId]);
    const woke = store.wakeSnoozed(a!.threadId, T0 + 6 * DAY);
    expect(woke.locations).toEqual([]); // already unread
    const items = store.listThreads({ view: "inbox" }, T0 + 7 * DAY).items;
    expect(items.map((i) => i.id)).toEqual([a!.threadId, b!.threadId]);
    expect(items[0]!.lastDate).toBe(T0 + 6 * DAY);
    expect(store.listThreads({ view: "snoozed" }, T0 + 7 * DAY).items).toEqual([]);
  });

  it("filters to threads with attachments on top of the view, so snoozed mail stays out", () => {
    const { store, s, ing } = fixture();
    const [a, , c] = ing(s.inbox.id,
      { uid: 1, subject: "pdf", from: [person("Al")], date: T0, hasAttachments: true },
      { uid: 2, subject: "plain", from: [person("Bo")], date: T0 + 1 },
      { uid: 3, subject: "snoozed pdf", from: [person("Cy")], date: T0 + 2, hasAttachments: true },
    );
    store.snooze([c!.threadId], T0 + 5 * DAY);
    expect(store.listThreads({ view: "inbox", hasAttachments: true }, T0 + DAY).items.map((i) => i.id)).toEqual([a!.threadId]);
  });

  it("filters by account and unified", () => {
    const store = makeStore();
    const a = seedImap(store, "a@example.com");
    const b = seedImap(store, "b@example.com");
    store.ingestMessages(a.account.id, a.inbox.id, [msg({ uid: 1, subject: "for a" })]);
    store.ingestMessages(b.account.id, b.inbox.id, [msg({ uid: 1, subject: "for b" })]);
    expect(store.listThreads({ view: "inbox" }).items).toHaveLength(2);
    expect(store.listThreads({ view: "inbox", accountId: b.account.id }).items.map((i) => i.subject)).toEqual(["for b"]);
  });

  it("filters unread only and sorts oldest first", () => {
    const { store, s, ing } = fixture();
    ing(s.inbox.id,
      { uid: 1, subject: "read", date: T0, flags: seenFlags, from: [person("A")] },
      { uid: 2, subject: "unread", date: T0 + 1, flags: unseen, from: [person("B")] },
      { uid: 3, subject: "newest unread", date: T0 + 2, flags: unseen, from: [person("C")] },
    );
    expect(store.listThreads({ view: "inbox", unreadOnly: true }).items.map((i) => i.subject)).toEqual(["newest unread", "unread"]);
    expect(store.listThreads({ view: "inbox", sort: "oldest" }).items.map((i) => i.subject)).toEqual(["read", "unread", "newest unread"]);
  });

  it("paginates with keyset cursors, including equal sort keys", () => {
    const { store, s, ing } = fixture();
    ing(s.inbox.id, ...Array.from({ length: 25 }, (_, i) => ({ uid: i + 1, subject: `t${i}`, from: [person(`P${i}`)], date: T0 + Math.floor(i / 5) * 1000 })));
    for (const sort of ["newest", "oldest"] as const) {
      const seen: number[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 10; guard++) {
        const page = store.listThreads({ view: "inbox", limit: 7, sort, cursor });
        seen.push(...page.items.map((i) => i.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      expect(seen).toHaveLength(25);
      expect(new Set(seen).size).toBe(25);
    }
    expect(store.listThreads({ view: "inbox", limit: 500 }).items).toHaveLength(25);
    expect(store.listThreads({ view: "inbox", limit: 0 }).items).toHaveLength(1);
    expect(() => store.listThreads({ view: "inbox", cursor: "garbage" })).toThrowError(FlintError);
  });
});

describe("listThreads: focused inbox and bundles", () => {
  it("lists people threads with bundles for notifications and newsletters", () => {
    const { store, s, ing } = fixture();
    ing(s.inbox.id,
      { uid: 1, subject: "friend", from: [person("Friend")], date: T0 + 10 },
      { uid: 2, subject: "build passed", from: [person("CI", "noreply@ci.com")], date: T0 + 20, flags: unseen },
      { uid: 3, subject: "build failed", from: [person("CI", "alerts@ci.com")], date: T0 + 30, flags: seenFlags },
      { uid: 4, subject: "weekly", from: [person("Brand", "news@brand.com")], date: T0 + 40, headers: { "list-id": "<b>" } },
    );
    const page = store.listThreads({ view: "inbox", focused: true });
    expect(page.items.map((i) => i.subject)).toEqual(["friend"]);
    expect(page.bundles.map((b) => b.category)).toEqual(["notifications", "newsletters"]);
    expect(page.bundles[0]).toMatchObject({ unreadCount: 1, totalCount: 2, lastDate: T0 + 30 });
    expect(page.bundles[0]!.latest.map((l) => l.subject)).toEqual(["build failed", "build passed"]);
    expect(page.bundles[0]!.latest[0]!.from.address).toBe("alerts@ci.com");
    expect(page.bundles[1]).toMatchObject({ totalCount: 1, unreadCount: 1 });
    const cat = store.listThreads({ view: "inbox", focused: true, category: "notifications" });
    expect(cat.items.map((i) => i.subject)).toEqual(["build failed", "build passed"]);
    expect(cat.bundles).toEqual([]);
    expect(store.listThreads({ view: "inbox" }).items).toHaveLength(4);
    expect(store.listThreads({ view: "sent", focused: true }).items).toEqual([]);
  });
});

describe("listThreads: other views (generic IMAP)", () => {
  it("covers sent, drafts, trash, spam, archive, pinned and folder", () => {
    const { store, s, ing } = fixture();
    const custom = store.upsertFolder(s.account.id, { path: "Projects" });
    ing(s.inbox.id, { uid: 1, subject: "in inbox" });
    ing(s.sent.id, { uid: 1, subject: "sent one", from: [me()], to: [person("Bo")] });
    ing(s.drafts.id, { uid: 1, subject: "draft one", from: [me()], flags: { seen: true, flagged: false, answered: false, draft: true } });
    ing(s.trash.id, { uid: 1, subject: "trashed" });
    ing(s.spam.id, { uid: 1, subject: "spammy" });
    ing(s.archive.id, { uid: 1, subject: "archived" });
    ing(custom.id, { uid: 1, subject: "in project" });
    ing(s.inbox.id, { uid: 2, subject: "pinned inbox", flags: { seen: false, flagged: true, answered: false, draft: false } });
    ing(s.trash.id, { uid: 2, subject: "pinned trash", flags: { seen: false, flagged: true, answered: false, draft: false } });
    const subjects = (view: Parameters<typeof store.listThreads>[0]["view"], extra = {}) => store.listThreads({ view, ...extra }).items.map((i) => i.subject).sort();
    expect(subjects("inbox")).toEqual(["in inbox", "pinned inbox"]);
    expect(subjects("sent")).toEqual(["sent one"]);
    expect(subjects("drafts")).toEqual(["draft one"]);
    expect(subjects("trash")).toEqual(["pinned trash", "trashed"]);
    expect(subjects("spam")).toEqual(["spammy"]);
    expect(subjects("archive")).toEqual(["archived"]);
    expect(subjects("pinned")).toEqual(["pinned inbox"]);
    expect(subjects("folder", { folderId: custom.id })).toEqual(["in project"]);
    expect(subjects("folder")).toEqual([]);
    expect(store.listThreads({ view: "drafts" }).items[0]!.hasDraft).toBe(true);
  });

  it("blocked view lists trashed mail from blocked senders", () => {
    const { store, s, ing } = fixture();
    expect(store.listThreads({ view: "blocked" }).items).toEqual([]);
    store.blockSender("bad@x.com");
    ing(s.trash.id, { uid: 1, subject: "from bad", from: [person("Bad", "bad@x.com")] }, { uid: 2, subject: "ordinary trash", from: [person("Ok", "ok@x.com")] });
    expect(store.listThreads({ view: "blocked" }).items.map((i) => i.subject)).toEqual(["from bad"]);
  });

  it("local drafts mark their thread with hasDraft", () => {
    const { store, s, ing } = fixture();
    const [o] = ing(s.inbox.id, { uid: 1, subject: "needs reply" });
    store.createDraft({ accountId: s.account.id, from: "me@example.com", mode: "reply", threadId: o!.threadId });
    expect(store.listThreads({ view: "inbox" }).items[0]!.hasDraft).toBe(true);
  });
});

describe("listThreads: Gmail views", () => {
  it("uses labels for inbox and derives archive from All Mail", () => {
    const store = makeStore();
    const g = seedGmail(store);
    store.ingestMessages(g.account.id, g.all.id, [
      msg({ uid: 1, gmMsgid: "1", gmThrid: "A", subject: "inboxed", gmLabels: ["INBOX"] }),
      msg({ uid: 2, gmMsgid: "2", gmThrid: "B", subject: "archived", gmLabels: [] }),
      msg({ uid: 3, gmMsgid: "3", gmThrid: "C", subject: "only sent", from: [me()], to: [person("Bo")], gmLabels: ["[Gmail]/Sent Mail"] }),
      msg({ uid: 4, gmMsgid: "4", gmThrid: "D", subject: "starred archived", gmLabels: [], flags: { seen: true, flagged: true, answered: false, draft: false } }),
    ]);
    store.ingestMessages(g.account.id, g.trash.id, [msg({ uid: 1, gmMsgid: "5", gmThrid: "E", subject: "trashed", gmLabels: ["[Gmail]/Trash"] })]);
    store.ingestMessages(g.account.id, g.spam.id, [msg({ uid: 1, gmMsgid: "6", gmThrid: "F", subject: "junk", gmLabels: ["[Gmail]/Spam"] })]);
    const subjects = (view: "inbox" | "archive" | "sent" | "trash" | "spam" | "pinned") => store.listThreads({ view }).items.map((i) => i.subject).sort();
    expect(subjects("inbox")).toEqual(["inboxed"]);
    expect(subjects("archive")).toEqual(["archived", "starred archived"]);
    expect(subjects("sent")).toEqual(["only sent"]);
    expect(subjects("trash")).toEqual(["trashed"]);
    expect(subjects("spam")).toEqual(["junk"]);
    expect(subjects("pinned")).toEqual(["starred archived"]);
    expect(store.listThreads({ view: "inbox", accountId: g.account.id }).items).toHaveLength(1);
  });

  it("archiving removes the inbox label and keeps the message in All Mail", () => {
    const store = makeStore();
    const g = seedGmail(store);
    const [o] = store.ingestMessages(g.account.id, g.all.id, [msg({ uid: 1, gmMsgid: "1", gmThrid: "A", gmLabels: ["INBOX"] })]);
    const res = store.moveThreads([o!.threadId], { kind: "archive" });
    expect(res.locations[0]!.memberFolderIds).toEqual([g.all.id]);
    expect(store.listThreads({ view: "inbox" }).items).toEqual([]);
    expect(store.listThreads({ view: "archive" }).items).toHaveLength(1);
  });
});

describe("listThreads: search view", () => {
  function seed() {
    const { store, s, ing } = fixture();
    ing(s.inbox.id,
      { uid: 1, subject: "Quarterly budget", from: [person("Zelda", "zelda@acme.com")], to: [me()], date: new Date(2026, 5, 10).getTime(), textBody: "numbers for the board", hasAttachments: true },
      { uid: 2, subject: "Lunch plans", from: [person("Pat", "pat@home.org")], to: [me()], date: new Date(2026, 8, 10).getTime(), textBody: "tacos on friday", flags: seenFlags },
    );
    ing(s.sent.id, { uid: 1, subject: "Re: Lunch plans", from: [me()], to: [person("Pat", "pat@home.org")], cc: [person("Quinn")], date: new Date(2026, 8, 11).getTime(), textBody: "friday works", flags: seenFlags });
    ing(s.trash.id, { uid: 1, subject: "Budget leftovers", from: [person("Trashy")], textBody: "budget", date: new Date(2026, 7, 1).getTime() });
    return { store, s };
  }
  const run = (store: ReturnType<typeof seed>["store"], search: string) => store.listThreads({ view: "search", search }).items.map((i) => i.subject).sort();

  it("matches words with prefix on the last word", () => {
    const { store } = seed();
    expect(run(store, "budget")).toEqual(["Quarterly budget"]);
    expect(run(store, "quart")).toEqual(["Quarterly budget"]);
    expect(run(store, "board numbers")).toEqual(["Quarterly budget"]);
    expect(run(store, '"tacos on friday"')).toEqual(["Lunch plans"]);
    expect(run(store, "friday -tacos")).toEqual(["Lunch plans"]);
    expect(run(store, "")).toEqual([]);
  });

  it("supports operators", () => {
    const { store } = seed();
    expect(run(store, "from:zelda")).toEqual(["Quarterly budget"]);
    expect(run(store, "from:@home.org")).toEqual(["Lunch plans"]);
    expect(run(store, "to:pat")).toEqual(["Lunch plans"]);
    expect(run(store, "cc:quinn")).toEqual(["Lunch plans"]);
    expect(run(store, "subject:lunch")).toEqual(["Lunch plans"]);
    expect(run(store, "has:attachment")).toEqual(["Quarterly budget"]);
    expect(run(store, "is:unread")).toEqual(["Quarterly budget"]);
    expect(run(store, "is:read")).toEqual(["Lunch plans"]);
    expect(run(store, "in:sent")).toEqual(["Lunch plans"]);
    expect(run(store, "in:trash budget")).toEqual(["Budget leftovers"]);
    expect(run(store, "after:2026-09-01")).toEqual(["Lunch plans"]);
    expect(run(store, "before:2026-07-01")).toEqual(["Quarterly budget"]);
    expect(run(store, "account:me@example.com from:pat")).toEqual(["Lunch plans"]);
    expect(run(store, "account:other@example.com")).toEqual([]);
    expect(run(store, "from:zelda -has:attachment")).toEqual([]);
  });

  it("supports is:pinned, is:snoozed and in:<folder name>", () => {
    const { store, s } = seed();
    store.setPinned([store.listThreads({ view: "search", search: "lunch" }).items[0]!.id], true);
    expect(run(store, "is:pinned")).toEqual(["Lunch plans"]);
    const t = store.listThreads({ view: "search", search: "quarterly" }).items[0]!.id;
    store.snooze([t], Date.now() + DAY);
    expect(run(store, "is:snoozed")).toEqual(["Quarterly budget"]);
    expect(run(store, "in:inbox")).toEqual(["Lunch plans", "Quarterly budget"]);
    expect(run(store, "in:INBOX is:read")).toEqual(["Lunch plans"]);
    expect(run(store, "in:Sent")).toEqual(["Lunch plans"]);
    expect(store.getFolderByPath(s.account.id, "INBOX")).not.toBeNull();
  });

  it("never throws on hostile input", () => {
    const { store } = seed();
    for (const q of ['"', "AND OR NOT", "NEAR(", "col:val", "*", "a*b", "(((", "-", "'; DROP TABLE messages; --", "\u0000", "from:", "before:nope"]) {
      expect(() => store.listThreads({ view: "search", search: q })).not.toThrow();
    }
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM messages").get()).toEqual({ n: 4 });
  });
});

describe("listThreads: receipts", () => {
  it("includes a summary when the thread's latest sent mail is tracked", () => {
    const { store, s, ing } = fixture();
    const [o] = ing(s.sent.id, { uid: 1, messageId: "sent1@x", subject: "Proposal", from: [me()], to: [person("Carla"), person("Dan")], flags: seenFlags });
    const tid = store.createTracked({ accountId: s.account.id, ref: "r1", messageId: "sent1@x", threadId: o!.threadId, subject: "Proposal", sentAt: T0, recipients: [{ email: "carla@example.org", token: "t1" }, { email: "dan@example.org", token: "t2" }] });
    store.ingestReceiptEvents([{ remoteId: "e1", token: "t1", at: T0 + 60_000, kind: "open", client: "Gmail", fingerprint: "f1" }]);
    expect(tid).toBeGreaterThan(0);
    expect(store.listThreads({ view: "sent" }).items[0]!.receipt).toEqual({ opened: 1, total: 2, status: "opened", lastOpenAt: T0 + 60_000 });
    // a later mail from me that is not tracked hides the summary
    ing(s.sent.id, { uid: 2, messageId: "sent2@x", references: ["sent1@x"], subject: "Re: Proposal", from: [me()], to: [person("Carla")], date: T0 + DAY, flags: seenFlags });
    expect(store.listThreads({ view: "sent" }).items[0]!.receipt).toBeNull();
  });
});
