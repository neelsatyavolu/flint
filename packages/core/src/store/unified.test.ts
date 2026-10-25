import { describe, expect, it } from "vitest";
import { makeStore, msg, person, seedImap, T0 } from "./testkit";

function setup() {
  const store = makeStore();
  const a = seedImap(store, "a@example.com");
  const b = seedImap(store, "b@example.com");
  const from = [person("Ann", "ann@example.org")];
  store.ingestMessages(a.account.id, a.inbox.id, [msg({ uid: 1, subject: "For A", from, date: T0 })]);
  store.ingestMessages(b.account.id, b.inbox.id, [msg({ uid: 1, subject: "For B", from, date: T0 + 1000 })]);
  return { store, a, b, subjects: (q: Parameters<typeof store.listThreads>[0]) => store.listThreads(q, T0 + 5000).items.map((i) => i.subject).sort() };
}

describe("show in unified inbox", () => {
  it("is on by default and lists every account", () => {
    const { store, a, subjects } = setup();
    expect(store.getAccount(a.account.id)!.showInUnified).toBe(true);
    expect(subjects({ view: "inbox" })).toEqual(["For A", "For B"]);
  });

  it("leaves a hidden account out of every all-accounts view but keeps its own inbox", () => {
    const { store, b, subjects } = setup();
    store.updateAccount(b.account.id, { showInUnified: false });
    expect(store.getAccount(b.account.id)!.showInUnified).toBe(false);
    expect(subjects({ view: "inbox" })).toEqual(["For A"]);
    expect(subjects({ view: "inbox", focused: true })).toEqual(["For A"]);
    expect(subjects({ view: "search", search: "For" })).toEqual(["For A"]);
    expect(subjects({ view: "inbox", accountId: b.account.id })).toEqual(["For B"]);
    expect(subjects({ view: "search", search: "For", accountId: b.account.id })).toEqual(["For B"]);
    store.updateAccount(b.account.id, { showInUnified: true });
    expect(subjects({ view: "inbox" })).toEqual(["For A", "For B"]);
  });

  it("applies to pinned and snoozed views", () => {
    const { store, a, b, subjects } = setup();
    for (const acc of [a, b]) {
      const t = store.listThreads({ view: "inbox", accountId: acc.account.id }).items[0]!;
      store.setPinned([t.id], true);
    }
    store.updateAccount(b.account.id, { showInUnified: false });
    expect(subjects({ view: "pinned" })).toEqual(["For A"]);
    expect(subjects({ view: "pinned", accountId: b.account.id })).toEqual(["For B"]);
  });

  it("leaves hidden accounts out of the unified bundles", () => {
    const { store, a, b } = setup();
    store.ingestMessages(b.account.id, b.inbox.id, [msg({ uid: 5, subject: "News B", date: T0 + 2000, headers: { "list-id": "<n.b.org>", "list-unsubscribe": "<https://b.org/u>" } })]);
    store.ingestMessages(a.account.id, a.inbox.id, [msg({ uid: 5, subject: "News A", date: T0 + 2000, headers: { "list-id": "<n.a.org>", "list-unsubscribe": "<https://a.org/u>" } })]);
    store.updateAccount(b.account.id, { showInUnified: false });
    const page = store.listThreads({ view: "inbox", focused: true }, T0 + 5000);
    expect(page.bundles.map((x) => x.latest.map((l) => l.subject))).toEqual([["News A"]]);
  });

  it("drops a hidden account from the sidebar totals but keeps its own unread", () => {
    const { store, b } = setup();
    expect(store.getSidebarData(T0 + 5000).counts.inbox).toBe(2);
    store.updateAccount(b.account.id, { showInUnified: false });
    const data = store.getSidebarData(T0 + 5000);
    expect(data.counts.inbox).toBe(1);
    expect(data.accounts.find((x) => x.account.id === b.account.id)!.inboxUnread).toBe(1);
  });

  it("leaves a hidden account's mail out of Home", () => {
    const { store, b } = setup();
    expect(store.getHomeData(T0 + 5000).unreadPeople.map((i) => i.subject).sort()).toEqual(["For A", "For B"]);
    store.updateAccount(b.account.id, { showInUnified: false });
    expect(store.getHomeData(T0 + 5000).unreadPeople.map((i) => i.subject)).toEqual(["For A"]);
  });
});
