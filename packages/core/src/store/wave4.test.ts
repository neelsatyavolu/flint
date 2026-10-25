import { describe, expect, it } from "vitest";
import { CATEGORIZER_VERSION } from "../categorize";
import { DAY, makeStore, me, msg, person, seedImap, T0 } from "./testkit";

const draftFlags = { seen: true, flagged: false, answered: false, draft: true };

describe("server drafts in threads", () => {
  function threadWithDraft() {
    const store = makeStore();
    const s = seedImap(store);
    const [a] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1, messageId: "a@x", subject: "Plan", date: T0 })]);
    const [d] = store.ingestMessages(s.account.id, s.drafts.id, [
      msg({ uid: 1, messageId: "d@x", inReplyTo: "a@x", references: ["a@x"], subject: "Re: Plan", from: [me()], to: [person("Carla")], flags: draftFlags, date: T0 + 5 * DAY, snippet: "half written reply" }),
    ]);
    expect(d!.threadId).toBe(a!.threadId);
    return { store, s, threadId: a!.threadId };
  }

  it("keeps drafts out of the conversation, last_date and counts", () => {
    const { store, threadId } = threadWithDraft();
    const rows = store.getThreadRows(threadId)!;
    expect(rows.messages.map((m) => m.messageId)).toEqual(["a@x"]);
    const item = store.listThreads({ view: "inbox" }).items.find((t) => t.id === threadId)!;
    expect(item.messageCount).toBe(1);
    expect(item.lastDate).toBe(T0);
    expect(item.snippet).not.toContain("half written");
    expect(item.hasDraft).toBe(true);
    expect(store.db.prepare("SELECT last_date FROM threads WHERE id = ?").get(threadId)).toEqual({ last_date: T0 });
  });

  it("still lists a draft-only thread in the Drafts folder and opens it", () => {
    const store = makeStore();
    const s = seedImap(store);
    const [d] = store.ingestMessages(s.account.id, s.drafts.id, [msg({ uid: 1, subject: "Fresh draft", from: [me()], flags: draftFlags })]);
    expect(store.listThreads({ view: "drafts" }).items.map((t) => t.id)).toContain(d!.threadId);
    expect(store.getThreadRows(d!.threadId)!.messages).toHaveLength(1);
  });
});

describe("joining by subject", () => {
  const two = (a: Parameters<typeof msg>[0], b: Parameters<typeof msg>[0]) => {
    const store = makeStore();
    const s = seedImap(store);
    const [first] = store.ingestMessages(s.account.id, s.inbox.id, [msg(a)]);
    const [second] = store.ingestMessages(s.account.id, s.inbox.id, [msg(b)]);
    return first!.threadId === second!.threadId;
  };

  it("joins an unlinked reply from the same person with the same subject", () => {
    expect(two({ uid: 1, messageId: "a@x", subject: "Project kickoff notes" }, { uid: 2, messageId: null, subject: "Re: Project kickoff notes", date: T0 + DAY })).toBe(true);
  });
  it("does not join generic subjects", () => {
    expect(two({ uid: 1, messageId: "a@x", subject: "Hello" }, { uid: 2, messageId: "b@x", subject: "Hello", date: T0 + DAY })).toBe(false);
    expect(two({ uid: 1, messageId: "a@x", subject: "Invoice" }, { uid: 2, messageId: "b@x", subject: "Invoice", date: T0 + DAY })).toBe(false);
  });
  it("does not join list or automated mail", () => {
    const list = { "list-unsubscribe": "<mailto:u@x>" };
    expect(two({ uid: 1, messageId: "a@x", subject: "Your weekly digest is ready" }, { uid: 2, messageId: "b@x", subject: "Your weekly digest is ready", date: T0 + DAY, headers: list })).toBe(false);
    expect(two({ uid: 1, messageId: "a@x", subject: "Your weekly digest is ready", headers: list }, { uid: 2, messageId: "b@x", subject: "Your weekly digest is ready", date: T0 + DAY })).toBe(false);
    expect(two({ uid: 1, messageId: "a@x", subject: "Build finished successfully" }, { uid: 2, messageId: "b@x", subject: "Build finished successfully", date: T0 + DAY, headers: { "auto-submitted": "auto-generated" } })).toBe(false);
  });
  it("keeps [tags] significant", () => {
    expect(two({ uid: 1, messageId: "a@x", subject: "[repo-a] Fix the parser" }, { uid: 2, messageId: "b@x", subject: "[repo-b] Fix the parser", date: T0 + DAY })).toBe(false);
  });
  it("does not join through a draft", () => {
    const store = makeStore();
    const s = seedImap(store);
    store.ingestMessages(s.account.id, s.drafts.id, [msg({ uid: 1, messageId: "d@x", subject: "Project kickoff notes", from: [me()], to: [person("Carla")], flags: draftFlags })]);
    const [b] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 2, messageId: "b@x", subject: "Project kickoff notes", date: T0 + DAY })]);
    expect(store.getThreadRows(b!.threadId)!.messages).toHaveLength(1);
  });
});

describe("recategorizeAll", () => {
  it("re-labels existing mail from its stored headers and recomputes threads", () => {
    const store = makeStore();
    const s = seedImap(store);
    const [scoir] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1, messageId: "s@x", subject: "A school viewed your profile", from: [person("Scoir", "automated@notifications.scoir.com")] })]);
    const [pal] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 2, messageId: "p@x", subject: "Lunch", from: [person("Pal", "pal@example.org")] })]);
    // Simulate mail labelled by the old categorizer, and a contact the user has written to.
    store.db.prepare("UPDATE messages SET category = 'people'").run();
    store.db.prepare("UPDATE threads SET category = 'people'").run();
    store.db.prepare("UPDATE messages SET headers_json = ? WHERE message_id = 's@x'").run(JSON.stringify({ "feedback-id": "1:scoir" }));
    store.touchSent(person("Pal", "pal@example.org"), T0);

    expect(store.recategorizeAll()).toBe(1);
    expect(store.getThreadRows(scoir!.threadId)!.category).toBe("notifications");
    expect(store.getThreadRows(pal!.threadId)!.category).toBe("people");
    expect(store.recategorizeAll()).toBe(0);
  });

  it("keeps a category a rule or the user chose", () => {
    const store = makeStore();
    const s = seedImap(store);
    const [scoir] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1, messageId: "s@x", subject: "A school viewed your profile", from: [person("Scoir", "automated@notifications.scoir.com")] })]);
    const [other] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 2, messageId: "o@x", subject: "Your receipt", from: [person("Shop", "automated@notifications.shop.com")] })]);
    store.db.prepare("UPDATE messages SET headers_json = ?").run(JSON.stringify({ "feedback-id": "1:scoir" }));
    // Both were filed as people by an older run; one was then moved by a rule, the other by the user.
    store.db.prepare("UPDATE messages SET category = 'people'").run();
    store.pinCategory([scoir!.threadId], "people", "rule");
    store.pinCategory([other!.threadId], "people", "manual");

    expect(store.recategorizeAll()).toBe(0);
    expect(store.getThreadRows(scoir!.threadId)!.category).toBe("people");
    expect(store.getThreadRows(other!.threadId)!.category).toBe("people");
  });

  it("records a rule's category on ingest and keeps it through re-categorizing", () => {
    const store = makeStore();
    const s = seedImap(store);
    store.saveRule({ accountId: null, name: "Scoir to people", enabled: true, match: "all", sortOrder: 0, conditions: [{ field: "from", op: "contains", value: "scoir" }], actions: [{ type: "category", category: "people" }] });
    const [scoir] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1, messageId: "s@x", subject: "A school viewed your profile", from: [person("Scoir", "automated@notifications.scoir.com")], headers: { "feedback-id": "1:scoir" } })]);
    expect(store.getThreadRows(scoir!.threadId)!.category).toBe("people");
    expect(store.recategorizeAll()).toBe(0);
    expect(store.getThreadRows(scoir!.threadId)!.category).toBe("people");
  });

  it("leaves sent mail alone", () => {
    const store = makeStore();
    const s = seedImap(store);
    store.ingestMessages(s.account.id, s.sent.id, [msg({ uid: 1, from: [me()], to: [person("Bob", "noreply@brand.com")] })]);
    expect(store.recategorizeAll()).toBe(0);
  });

  it("exposes a version to compare against", () => {
    expect(CATEGORIZER_VERSION).toBeGreaterThan(1);
  });
});
