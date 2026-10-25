import { describe, expect, it } from "vitest";
import { makeStore, me, msg, person, seedGmail, seedImap, T0 } from "./testkit";

const draftFlags = { seen: true, flagged: false, answered: false, draft: true };

function fixture() {
  const store = makeStore();
  const s = seedImap(store);
  const serverDraft = (uid: number, over: Parameters<typeof msg>[0] extends infer T ? Partial<T> : never = {}) =>
    store.ingestMessages(s.account.id, s.drafts.id, [msg({ uid, from: [me()], to: [person("Bob")], subject: `Server ${uid}`, flags: draftFlags, ...over })]);
  return { store, s, serverDraft };
}

describe("Drafts view", () => {
  it("lists local drafts that were never synced, newest first, with the Draft fields", () => {
    const { store, s } = fixture();
    store.createDraft({ accountId: s.account.id, from: "me@example.com" }, T0);
    store.createDraft({ accountId: s.account.id, from: "me@example.com", to: [person("Bob")], subject: "Plan", html: "<p>Here is <b>the</b> plan</p>" }, T0 + 5000);
    const page = store.listThreads({ view: "drafts" });
    expect(page.items.map((i) => i.subject)).toEqual(["Plan", "(No subject)"]);
    expect(page.items[0]).toMatchObject({
      accountId: s.account.id, snippet: "Here is the plan", hasDraft: true, lastDate: T0 + 5000, unreadCount: 0,
      draft: { messageId: null },
    });
    expect(page.items[0]!.participants.map((p) => p.address)).toEqual(["bob@example.org"]);
    expect(page.items[0]!.id).toBeLessThan(0);
    expect(page.items[0]!.draft!.draftId).toBe(-page.items[0]!.id);
  });

  it("merges server drafts and shows each once, with and without a local draft behind it", () => {
    const { store, s, serverDraft } = fixture();
    serverDraft(1, { messageId: "linked@x", subject: "Linked" });
    serverDraft(2, { messageId: "elsewhere@x", subject: "From Gmail web", date: T0 + 9000 });
    const linked = store.createDraft({ accountId: s.account.id, from: "me@example.com", subject: "Linked" }, T0 + 100);
    store.setDraftMeta(linked.id, { serverUid: 1, serverMessageId: "linked@x" });

    const items = store.listThreads({ view: "drafts" }).items;
    expect(items.map((i) => i.subject)).toEqual(["From Gmail web", "Linked"]);
    expect(items[0]!.draft!.messageId).not.toBeNull();
    expect(items[0]!.draft!.draftId).toBeNull();
    expect(items[0]!.participants.map((p) => p.address)).toEqual(["bob@example.org"]);
    expect(items[1]!.draft!.draftId).toBe(linked.id);
    expect(store.getSidebarData().counts.drafts).toBe(items.length);
  });

  it("matches the server copy by UID in the Drafts folder when no Message-ID is stored", () => {
    const { store, s, serverDraft } = fixture();
    serverDraft(7, { messageId: "legacy@x", subject: "Legacy" });
    const d = store.createDraft({ accountId: s.account.id, from: "me@example.com", subject: "Legacy" });
    store.setDraftMeta(d.id, { serverUid: 7 });
    expect(store.listThreads({ view: "drafts" }).items).toHaveLength(1);
    expect(store.findDraftByServerCopy(s.account.id, "legacy@x", s.drafts.id, 7)?.id).toBe(d.id);
  });

  it("matches a Gmail copy by Message-ID even though its UID differs", () => {
    const store = makeStore();
    const g = seedGmail(store);
    store.ingestMessages(g.account.id, g.all.id, [msg({ uid: 400, messageId: "gm@x", from: [me()], subject: "Gmail copy", flags: draftFlags })]);
    store.applyGmailLabels(g.all.id, [{ uid: 400, labels: ["[Gmail]/Drafts"] }]);
    const d = store.createDraft({ accountId: g.account.id, from: "me@gmail.com", subject: "Gmail copy" });
    store.setDraftMeta(d.id, { serverUid: 3, serverMessageId: "gm@x" });
    const items = store.listThreads({ view: "drafts" }).items;
    expect(items).toHaveLength(1);
    expect(items[0]!.draft!.draftId).toBe(d.id);
  });

  it("filters by account, pages with a cursor and keeps the sidebar count equal to the list", () => {
    const { store, s, serverDraft } = fixture();
    const other = seedImap(store, "other@example.com");
    for (let i = 0; i < 5; i++) store.createDraft({ accountId: s.account.id, from: "me@example.com", subject: `L${i}` }, T0 + i * 1000);
    store.createDraft({ accountId: other.account.id, from: "other@example.com", subject: "Other" }, T0 + 50_000);
    serverDraft(1, { subject: "S1", date: T0 + 2500 });

    const all = store.listThreads({ view: "drafts" }).items;
    expect(all).toHaveLength(7);
    expect(store.getSidebarData().counts.drafts).toBe(7);
    expect(store.listThreads({ view: "drafts", accountId: other.account.id }).items.map((i) => i.subject)).toEqual(["Other"]);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = store.listThreads({ view: "drafts", limit: 3, ...(cursor ? { cursor } : {}) });
      seen.push(...page.items.map((i) => i.subject));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(all.map((i) => i.subject));
    expect(store.listThreads({ view: "drafts", sort: "oldest" }).items.map((i) => i.subject)[0]).toBe("L0");
    expect(store.listThreads({ view: "drafts", unreadOnly: true }).items).toEqual([]);
  });
});
