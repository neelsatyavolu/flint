import { describe, expect, it, vi } from "vitest";
import { makeStore, msg, person, seedImap, T0 } from "../store/testkit";
import type { FlintEvent } from "../types";
import { baseSettings } from "./testing";
import { createStoreCategorizer } from "./wire";

describe("createStoreCategorizer", () => {
  it("moves college outreach out of people and tells the UI", async () => {
    const store = makeStore();
    const s = seedImap(store);
    store.ingestMessages(s.account.id, s.inbox.id, [
      msg({ uid: 1, subject: "Application deadline", from: [person("Office of Admissions", "admissions@uni.edu")], textBody: "Apply now. Unsubscribe here. © 2026", date: T0 }),
      msg({ uid: 2, subject: "dinner", from: [person("Priya Shah", "priya@gmail.com")], textBody: "Are you around Friday?", date: T0 + 1 }),
    ]);
    const events: FlintEvent[] = [];
    const complete = vi.fn(async (_system: string, _user: string) => '[{"id":1,"category":"newsletters"}]');
    const cat = createStoreCategorizer({ store, engine: { complete }, getSettings: () => baseSettings({ autoCategorize: true }), now: () => T0 + 1000, emit: (e) => events.push(e) });
    expect(await cat.runOnce()).toMatchObject({ status: "asked", sent: 1 });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]![1]).toContain("admissions@uni.edu");
    expect(complete.mock.calls[0]![1]).not.toContain("priya@gmail.com");
    expect(store.listThreads({ view: "inbox", category: "newsletters" }).items.map((i) => i.subject)).toEqual(["Application deadline"]);
    expect(events).toEqual([{ type: "mail_changed", accountId: s.account.id, threadIds: [expect.any(Number)] }]);
    expect(await cat.runOnce()).toEqual({ status: "idle" });
  });

  it("sends nothing while the setting is off", async () => {
    const store = makeStore();
    const s = seedImap(store);
    store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1, from: [person("Admissions", "admissions@uni.edu")], textBody: "Unsubscribe", date: T0 })]);
    const complete = vi.fn(async (_system: string, _user: string) => "[]");
    const cat = createStoreCategorizer({ store, engine: { complete }, getSettings: () => baseSettings({ autoCategorize: false }), now: () => T0, emit: () => {} });
    expect(await cat.runOnce()).toEqual({ status: "off" });
    expect(complete).not.toHaveBeenCalled();
  });
});
