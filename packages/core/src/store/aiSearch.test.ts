import { describe, expect, it } from "vitest";
import { aiThreadBriefs, applyCategoryVerdicts, buildRankedMatch, categorizeCandidates, rankedThreadSearch } from "./aiSearch";
import { DAY, makeStore, me, msg, person, seedImap, T0 } from "./testkit";

function fixture() {
  const store = makeStore();
  const s = seedImap(store);
  const ing = (...m: Parameters<typeof msg>[0][]) => store.ingestMessages(s.account.id, s.inbox.id, m.map(msg));
  return { store, s, ing };
}
const q = (terms: string[], extra: Partial<Parameters<typeof rankedThreadSearch>[1]> = {}) =>
  ({ terms, phrases: [], from: [], limit: 10, ...extra });

describe("buildRankedMatch", () => {
  it("OR-s prefix terms and exact phrases and ignores punctuation", () => {
    expect(buildRankedMatch(["invoice", "ac-me"], ["q3 budget"])).toBe('"invoice" * OR "ac me" * OR "q3 budget"');
    expect(buildRankedMatch(["!!"], [])).toBeNull();
  });
});

describe("rankedThreadSearch", () => {
  it("finds a thread that matches only some of the words and stems by prefix", () => {
    const { store, ing } = fixture();
    ing({ uid: 1, subject: "Invoice 2291", textBody: "Quillworks sent invoices for October", date: T0 });
    ing({ uid: 2, subject: "Lunch", textBody: "pizza on friday", date: T0 + 1000 });
    const hits = rankedThreadSearch(store, q(["invoice", "budget", "meeting"]), T0 + DAY);
    expect(hits.map((h) => h.subject)).toEqual(["Invoice 2291"]);
  });

  it("ranks by relevance, not only recency", () => {
    const { store, ing } = fixture();
    ing({ uid: 1, subject: "Budget review", textBody: "budget budget numbers for the quarterly budget", date: T0 });
    ing({ uid: 2, subject: "Hello", textBody: "one passing mention of the budget", date: T0 + 2 * DAY });
    const hits = rankedThreadSearch(store, q(["budget"]), T0 + 3 * DAY);
    expect(hits[0]!.subject).toBe("Budget review");
  });

  it("lets a newer thread win when relevance is equal", () => {
    const { store, ing } = fixture();
    ing({ uid: 1, subject: "Flight", textBody: "lisbon trip details", date: T0 });
    ing({ uid: 2, subject: "Flight", textBody: "lisbon trip details", date: T0 + 100 * DAY, messageId: "other@x" });
    const hits = rankedThreadSearch(store, q(["lisbon"]), T0 + 101 * DAY);
    expect(hits).toHaveLength(2);
    expect(hits[0]!.date).toBeGreaterThan(hits[1]!.date);
  });

  it("returns one row per thread and skips trash", () => {
    const { store, s, ing } = fixture();
    ing(
      { uid: 1, messageId: "a@x", subject: "Plan", textBody: "alpha plan", date: T0 },
      { uid: 2, messageId: "b@x", inReplyTo: "a@x", references: ["a@x"], subject: "Re: Plan", textBody: "alpha again", date: T0 + 1000 },
    );
    store.ingestMessages(s.account.id, s.trash.id, [msg({ uid: 1, subject: "Gone", textBody: "alpha deleted" })]);
    const hits = rankedThreadSearch(store, q(["alpha"]), T0 + DAY);
    expect(hits.map((h) => h.subject)).toEqual(["Plan"]);
  });

  it("applies a date window and a sender filter, and works with no words", () => {
    const { store, ing } = fixture();
    ing({ uid: 1, subject: "Old", from: [person("Ana", "ana@x.com")], date: T0 });
    ing({ uid: 2, subject: "New", from: [person("Bob", "bob@x.com")], date: T0 + 10 * DAY });
    expect(rankedThreadSearch(store, q([], { after: T0 + 5 * DAY }), T0 + 11 * DAY).map((h) => h.subject)).toEqual(["New"]);
    expect(rankedThreadSearch(store, q([], { from: ["ana@x.com"] }), T0 + 11 * DAY).map((h) => h.subject)).toEqual(["Old"]);
    expect(rankedThreadSearch(store, q([]), T0)).toEqual([]);
  });
});

describe("aiThreadBriefs", () => {
  it("describes the newest message: sender, own text, unread and whether the user wrote it", () => {
    const { store, ing } = fixture();
    ing(
      { uid: 1, messageId: "a@x", subject: "Plan", from: [person("Carla")], textBody: "Are we on for Thursday?\n\n> old quote", date: T0 },
      { uid: 2, messageId: "b@x", inReplyTo: "a@x", references: ["a@x"], subject: "Re: Plan", from: [me()], textBody: "Yes.", date: T0 + 1000, flags: { seen: true, flagged: false, answered: false, draft: false } },
    );
    ing({ uid: 3, messageId: "c@x", subject: "Lunch", from: [person("Dan")], textBody: "Can you send the menu?\n-- \nDan", date: T0 + 2000 });
    const briefs = aiThreadBriefs(store, "unread_people", 10, T0 + DAY);
    const lunch = briefs.find((b) => b.subject === "Lunch")!;
    expect(lunch).toMatchObject({ lastText: "Can you send the menu?", lastFromMe: false, unreadCount: 1, from: { address: "dan@example.org" } });
    expect(lunch.self?.addresses).toContain("me@example.com");
    const plan = aiThreadBriefs(store, "needs_reply_candidates", 10, T0 + DAY).find((b) => b.subject === "Plan")!;
    expect(plan.lastFromMe).toBe(true);
  });

  it("lists a bundle's unread threads first", () => {
    const { store, ing } = fixture();
    ing({ uid: 1, subject: "Shipped", from: [person("Shop", "no-reply@shop.com")], textBody: "Your order shipped", headers: { "auto-submitted": "auto-generated" }, date: T0 });
    expect(aiThreadBriefs(store, "notifications", 10, T0 + DAY).map((b) => b.subject)).toEqual(["Shipped"]);
    expect(aiThreadBriefs(store, "newsletters", 10, T0 + DAY)).toEqual([]);
  });
});

describe("categorizeCandidates and applyCategoryVerdicts", () => {
  it("offers recent people mail from unknown senders, skipping contacts and own mail", () => {
    const { store, s, ing } = fixture();
    ing(
      { uid: 1, subject: "Admissions update", from: [person("Admissions", "admissions@uni.edu")], textBody: "Your application status", date: T0 },
      { uid: 2, subject: "Hi", from: [person("Friend", "friend@x.com")], textBody: "hey", date: T0 + 1 },
    );
    store.ingestMessages(s.account.id, s.sent.id, [msg({ uid: 1, from: [me()], to: [person("Friend", "friend@x.com")], date: T0 - 1000, flags: { seen: true, flagged: false, answered: false, draft: false } })]);
    const out = categorizeCandidates(store, T0 + DAY, 10);
    expect(out.map((c) => c.from.address)).toEqual(["admissions@uni.edu"]);
    expect(out[0]).toMatchObject({ subject: "Admissions update", isReply: false });
  });

  it("stores a verdict on the message and moves the thread out of people", () => {
    const { store, ing } = fixture();
    ing({ uid: 1, subject: "Admissions update", from: [person("Admissions", "admissions@uni.edu")], textBody: "Apply now", date: T0 });
    const [c] = categorizeCandidates(store, T0 + DAY, 10);
    const changed = applyCategoryVerdicts(store, [{ messageId: c!.messageId, category: "newsletters" }]);
    expect(changed).toEqual([c!.threadId]);
    expect(store.listThreads({ view: "inbox", category: "newsletters" }).items.map((i) => i.subject)).toEqual(["Admissions update"]);
    expect(categorizeCandidates(store, T0 + DAY, 10)).toEqual([]);
    expect(applyCategoryVerdicts(store, [{ messageId: c!.messageId, category: "newsletters" }])).toEqual([]);
  });
});
