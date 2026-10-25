import { describe, expect, it } from "vitest";
import { makeStore, msg, person, seedImap } from "../store/testkit";
import type { FlintEvent } from "../types";
import { actionsApi } from "./actions";
import type { ServiceContext } from "./context";
import { createOptimistic } from "./optimistic";
import { UndoRegistry } from "./undo";

function setup(undoTtlMs?: number) {
  const store = makeStore();
  const s = seedImap(store);
  const events: FlintEvent[] = [];
  const hotel = person("Grand Hotel", "concierge@grandhotel.com");
  const out = store.ingestMessages(s.account.id, s.inbox.id, [
    msg({ uid: 1, subject: "Your request", from: [hotel], headers: { "list-unsubscribe": "<mailto:x@y.z>" } }),
    msg({ uid: 2, subject: "Another one", from: [hotel] }),
    msg({ uid: 3, subject: "Lunch?", from: [person("Dana", "dana@friends.org")] }),
  ]);
  const undo = new UndoRegistry(undoTtlMs === undefined ? {} : { ttlMs: undoTtlMs });
  const optimistic = createOptimistic({ store, emit: (e) => events.push(e), undo, actionsFor: () => { throw new Error("no server in this test"); }, caller: () => undefined });
  const ctx = { store, optimistic, now: () => Date.now(), scheduler: { poke() {} }, emit: (e: FlintEvent) => events.push(e) } as unknown as ServiceContext;
  const api = actionsApi(ctx);
  return { store, s, out, api, events, hotel };
}

const inboxOf = (store: ReturnType<typeof makeStore>, category: string) =>
  store.listThreads({ view: "inbox", category: category as "people", limit: 50 }, Date.now()).items.map((t) => t.subject).sort();

describe("setCategory", () => {
  it("moves a thread, emits mail_changed and survives a re-categorize", async () => {
    const { store, out, api, events } = setup();
    const id = out.find((o) => o.uid === 3)!.threadId;
    expect(inboxOf(store, "people")).toContain("Lunch?");
    await api.setCategory([id], "notifications");
    expect(inboxOf(store, "notifications")).toContain("Lunch?");
    expect(events.some((e) => e.type === "mail_changed")).toBe(true);
    store.recategorizeAll();
    expect(inboxOf(store, "notifications")).toContain("Lunch?");
  });

  it("undo puts the category and its source back", async () => {
    const { store, out, api } = setup();
    const id = out.find((o) => o.uid === 3)!.threadId;
    const { undoToken } = await api.setCategory([id], "newsletters");
    expect(inboxOf(store, "newsletters")).toContain("Lunch?");
    await api.undo(undoToken);
    expect(inboxOf(store, "people")).toContain("Lunch?");
    store.recategorizeAll();
    expect(inboxOf(store, "people")).toContain("Lunch?");
  });

  it("with sender: moves the sender's other mail and files future mail the same way, undo removes the rule", async () => {
    const { store, s, out, api, hotel } = setup();
    const first = out.find((o) => o.uid === 1)!.threadId;
    await api.setCategory([first], "people", { sender: true });
    expect(inboxOf(store, "people")).toEqual(expect.arrayContaining(["Your request", "Another one"]));
    expect(store.listRules()).toHaveLength(1);

    const [later] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 9, subject: "Newsletter!", from: [hotel], headers: { "list-unsubscribe": "<mailto:x@y.z>", "list-id": "<news.grandhotel.com>" } })]);
    expect(store.getThreadRows(later!.threadId)!.category).toBe("people");

    await api.setCategory([first], "notifications", { sender: true });
    expect(store.listRules()).toHaveLength(1);
    expect(store.listRules()[0]!.actions).toEqual([{ type: "category", category: "notifications" }]);
  });

  it("undoing a sender move removes the rule it created", async () => {
    const { store, out, api } = setup();
    const first = out.find((o) => o.uid === 1)!.threadId;
    const { undoToken } = await api.setCategory([first], "newsletters", { sender: true });
    expect(store.listRules()).toHaveLength(1);
    await api.undo(undoToken);
    expect(store.listRules()).toHaveLength(0);
    expect(inboxOf(store, "newsletters")).not.toContain("Another one");
  });

  it("an expired undo fails as a whole: the move and its sender rule both stay, and nothing is left to run later", async () => {
    const { store, out, api } = setup(-1);
    const first = out.find((o) => o.uid === 1)!.threadId;
    const { undoToken } = await api.setCategory([first], "newsletters", { sender: true });
    await expect(api.undo(undoToken)).rejects.toThrow(/can't be undone/);
    expect(store.listRules()).toHaveLength(1);
    expect(inboxOf(store, "newsletters")).toContain("Your request");
    await expect(api.undo(undoToken)).rejects.toThrow(/can't be undone/);
    expect(store.listRules()).toHaveLength(1);
  });

  it("rejects an unknown category and an empty selection", async () => {
    const { api } = setup();
    await expect(api.setCategory([1], "spam" as never)).rejects.toThrow();
    await expect(api.setCategory([], "people")).rejects.toThrow();
  });
});
