import { describe, expect, it } from "vitest";
import { DAY, makeStore, me, msg, person, seedGmail, seedImap, T0 } from "./testkit";

describe("sidebar data", () => {
  it("counts unread inbox threads per account, with folders and badges", () => {
    const store = makeStore();
    const a = seedImap(store, "a@example.com");
    const b = seedGmail(store, "b@gmail.com");
    store.ingestMessages(a.account.id, a.inbox.id, [
      msg({ uid: 1, subject: "one", from: [person("A")] }), msg({ uid: 2, subject: "two", from: [person("B")] }),
      msg({ uid: 3, subject: "read", from: [person("C")], flags: { seen: true, flagged: true, answered: false, draft: false } }),
    ]);
    store.ingestMessages(a.account.id, a.spam.id, [msg({ uid: 1, subject: "junk" })]);
    store.ingestMessages(b.account.id, b.all.id, [msg({ uid: 1, gmMsgid: "1", gmThrid: "T", subject: "gmail one", gmLabels: ["INBOX"] })]);
    const [snoozed] = store.ingestMessages(a.account.id, a.inbox.id, [msg({ uid: 9, subject: "later", from: [person("D")] })]);
    store.snooze([snoozed!.threadId], Date.now() + DAY);
    store.createDraft({ accountId: a.account.id, from: "a@example.com" });
    const d = store.createDraft({ accountId: a.account.id, from: "a@example.com", subject: "x" });
    store.createScheduledSend({ draftId: d.id, sendAt: 1 });
    store.createScheduledSend({ draftId: d.id, sendAt: 2, status: "awaiting_approval" });

    const side = store.getSidebarData();
    expect(side.accounts.map((x) => [x.account.email, x.inboxUnread])).toEqual([["a@example.com", 2], ["b@gmail.com", 1]]);
    expect(side.accounts[0]!.folders.map((f) => f.path)).toContain("INBOX");
    expect(side.counts).toEqual({ inbox: 3, pinned: 1, drafts: 2, snoozed: 1, scheduled: 1, awaitingApproval: 1, spam: 1 });
  });

  it("ignores disabled accounts in badge counts", () => {
    const store = makeStore();
    const a = seedImap(store);
    store.ingestMessages(a.account.id, a.inbox.id, [msg({ uid: 1 })]);
    store.updateAccount(a.account.id, { enabled: false });
    expect(store.getSidebarData().counts.inbox).toBe(0);
  });
});

describe("home data", () => {
  it("assembles the home screen lists", () => {
    const store = makeStore();
    const s = seedImap(store);
    store.updateAccount(s.account.id, { name: "Neel Satyavolu" });
    store.ingestMessages(s.account.id, s.inbox.id, [
      msg({ uid: 1, subject: "friend", from: [person("Friend")] }),
      msg({ uid: 2, subject: "bot", from: [person("Bot", "noreply@x.com")] }),
      msg({ uid: 3, subject: "starred", from: [person("Pal")], flags: { seen: true, flagged: true, answered: false, draft: false } }),
    ]);
    const [sent] = store.ingestMessages(s.account.id, s.sent.id, [msg({ uid: 1, messageId: "s@x", subject: "waiting", from: [me()], to: [person("Carla")], flags: { seen: true, flagged: false, answered: false, draft: false } })]);
    store.createReminder({ accountId: s.account.id, threadId: sent!.threadId, messageId: "s@x", remindAt: T0 + DAY });
    store.createTracked({ accountId: s.account.id, ref: "r", messageId: "s@x", threadId: sent!.threadId, subject: "waiting", sentAt: T0, recipients: [{ email: "carla@example.org", token: "t" }] });
    const d = store.createDraft({ accountId: s.account.id, from: "me@example.com" });
    store.createScheduledSend({ draftId: d.id, sendAt: 5 });
    const snooze = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 4, subject: "soon", from: [person("Z")] })])[0]!;
    const now = new Date(2026, 9, 25, 9, 0, 0).getTime();
    store.snooze([snooze.threadId], new Date(2026, 9, 25, 15, 0, 0).getTime());

    const home = store.getHomeData(now);
    expect(home.greetingName).toBe("Neel");
    expect(home.unreadPeople.map((i) => i.subject).sort()).toEqual(["friend"]);
    expect(home.pinned.map((i) => i.subject)).toEqual(["starred"]);
    expect(home.awaitingReply.map((i) => i.subject)).toEqual(["waiting"]);
    expect(home.recentReceipts).toHaveLength(1);
    expect(home.snoozedToday).toBe(1);
    expect(home.scheduledCount).toBe(1);
  });

  it("falls back to the email name and handles an empty store", () => {
    const store = makeStore();
    expect(store.getHomeData().greetingName).toBe("");
    const s = seedImap(store, "sam.lee@example.com");
    store.updateAccount(s.account.id, { name: "" });
    expect(store.getHomeData().greetingName).toBe("sam.lee");
  });
});
