import { describe, expect, it, vi } from "vitest";
import { baseSettings } from "../ai/testing";
import { makeStore, msg, person, seedImap, T0 } from "../store/testkit";
import type { FlintEvent } from "../types";
import { EventBus } from "./events";
import { startCategorizer } from "./categorizerWiring";

function setup(autoCategorize: boolean, complete: (s: string, u: string) => Promise<string>) {
  const store = makeStore();
  const s = seedImap(store);
  store.ingestMessages(s.account.id, s.inbox.id, [
    msg({ uid: 1, subject: "Application deadline", from: [person("Office of Admissions", "admissions@uni.edu")], textBody: "Apply now. Unsubscribe here. © 2026", date: T0 }),
  ]);
  const bus = new EventBus();
  const events: FlintEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const stop = startCategorizer({
    store, bus, engine: { complete }, getSettings: () => baseSettings({ autoCategorize }), now: () => T0 + 1000,
    options: { debounceMs: 0, minGapMs: 60_000 },
  });
  return { store, bus, events, stop, accountId: s.account.id };
}

describe("startCategorizer", () => {
  it("recategorizes on new_mail when autoCategorize is on", async () => {
    const complete = vi.fn(async () => '[{"id":1,"category":"newsletters"}]');
    const { store, bus, events, stop } = setup(true, complete);
    bus.emit({ type: "new_mail", threadId: 1 } as FlintEvent);
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(store.listThreads({ view: "inbox", category: "newsletters" }).items).toHaveLength(1));
    expect(events.some((e) => e.type === "mail_changed")).toBe(true);
    stop();
  });

  it("does nothing while autoCategorize is off", async () => {
    const complete = vi.fn(async () => "[]");
    const { bus, stop } = setup(false, complete);
    bus.emit({ type: "mail_changed", accountId: "x" } as FlintEvent);
    await new Promise((r) => setTimeout(r, 50));
    expect(complete).not.toHaveBeenCalled();
    stop();
  });

  it("stops listening after dispose", async () => {
    const complete = vi.fn(async () => '[{"id":1,"category":"newsletters"}]');
    const { bus, stop } = setup(true, complete);
    stop();
    expect(bus.size).toBe(1);
    bus.emit({ type: "new_mail", threadId: 1 } as FlintEvent);
    await new Promise((r) => setTimeout(r, 50));
    expect(complete).not.toHaveBeenCalled();
  });
});
