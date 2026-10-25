import { describe, expect, it, vi } from "vitest";
import type { Bundle, Settings } from "@flint/core";
import { actionMessage, performAction, removesFromView, senderLabel, type ActionDeps, type NotifyInput } from "./actions";
import { createListStore } from "./listStore";
import { createNavStore } from "./nav";
import { bundle, item } from "./testFixtures";
import { categoryMenuItems, rowMenuItems } from "../features/mail/rowMenu";

const hotel = { name: "Grand Hotel", address: "concierge@grandhotel.com" };
const ITEMS = [item(1, { participants: [hotel], unreadCount: 1 }), item(2), item(3)];

function setup(opts: { fail?: boolean; bundles?: Bundle[] } = {}) {
  const setCategory = vi.fn(async () => {
    if (opts.fail) throw new Error("down");
    return { undoToken: "c1" };
  });
  const api = {
    archive: vi.fn(), trash: vi.fn(), markSpam: vi.fn(), setPinned: vi.fn(), markRead: vi.fn(), setMuted: vi.fn(), snooze: vi.fn(),
    unsnooze: vi.fn(), moveToFolder: vi.fn(), moveToInbox: vi.fn(), setCategory, undo: vi.fn(async () => undefined),
  } as unknown as ActionDeps["api"];
  const list = createListStore({ listThreads: async () => ({ items: ITEMS, bundles: opts.bundles ?? [bundle("notifications", 1, 2)], nextCursor: null }) });
  const nav = createNavStore();
  const notes: NotifyInput[] = [];
  const deps: ActionDeps = { api, list, nav, notify: (t) => notes.push(t), getSettings: () => ({ inbox: { afterArchive: "next", focused: true } }) as Settings };
  nav.getState().go({ view: "inbox" });
  return { setCategory, list, nav, deps, notes };
}

async function loaded(s: ReturnType<typeof setup>) {
  s.list.getState().setQuery({ view: "inbox" });
  await vi.waitFor(() => expect(s.list.getState().status).toBe("ready"));
}

describe("category action", () => {
  it("leaves the focused inbox only when it is not People, and leaves a category list when it moves elsewhere", () => {
    expect(removesFromView({ type: "category", category: "notifications" }, { view: "inbox", focused: true })).toBe(true);
    expect(removesFromView({ type: "category", category: "people" }, { view: "inbox", focused: true })).toBe(false);
    expect(removesFromView({ type: "category", category: "people" }, { view: "inbox", category: "newsletters" })).toBe(true);
    expect(removesFromView({ type: "category", category: "newsletters" }, { view: "inbox", category: "newsletters" })).toBe(false);
    expect(removesFromView({ type: "category", category: "notifications" }, { view: "inbox", focused: false })).toBe(false);
    expect(removesFromView({ type: "category", category: "notifications" }, { view: "pinned" })).toBe(false);
  });

  it("words the toast", () => {
    expect(actionMessage({ type: "category", category: "notifications" }, 1)).toBe("Moved to Notifications");
    expect(actionMessage({ type: "category", category: "people" }, 3)).toBe("Moved 3 conversations to People");
    expect(actionMessage({ type: "category", category: "newsletters", sender: true }, 1)).toBe("Mail from this sender will go to Newsletters");
  });

  it("names the sender, or says 'these senders' for several", () => {
    expect(senderLabel([ITEMS[0]!])).toBe("Grand Hotel");
    expect(senderLabel([ITEMS[0]!, ITEMS[1]!])).toBe("these senders");
    expect(senderLabel([item(9, { participants: [{ name: "me", address: "me@x.test" }] })])).toBeNull();
  });

  it("hides the row and grows the bundle at once, then offers Undo and Always for the sender", async () => {
    const s = setup();
    await loaded(s);
    const p = performAction(s.deps, { type: "category", category: "notifications" }, [1]);
    expect(s.list.getState().items.map((i) => i.id)).toEqual([2, 3]);
    expect(s.list.getState().bundles[0]).toMatchObject({ category: "notifications", totalCount: 4, unreadCount: 3 });
    await p;
    expect(s.setCategory).toHaveBeenCalledWith([1], "notifications", undefined);
    expect(s.notes[0]).toMatchObject({ message: "Moved to Notifications", action: { label: "Undo" }, secondaryAction: { label: "Always for Grand Hotel" } });

    s.notes[0]!.secondaryAction!.onClick();
    await vi.waitFor(() => expect(s.setCategory).toHaveBeenLastCalledWith([1], "notifications", { sender: true }));
    await vi.waitFor(() => expect(s.notes[1]?.message).toBe("Mail from this sender will go to Notifications"));
    expect(s.notes[1]?.secondaryAction).toBeUndefined();
  });

  it("creates the bundle when there was none", async () => {
    const s = setup({ bundles: [] });
    await loaded(s);
    const p = performAction(s.deps, { type: "category", category: "newsletters" }, [1]);
    expect(s.list.getState().bundles).toMatchObject([{ category: "newsletters", totalCount: 1, unreadCount: 1 }]);
    await p;
  });

  it("puts the row back and reports when the API fails", async () => {
    const s = setup({ fail: true });
    await loaded(s);
    await performAction(s.deps, { type: "category", category: "notifications" }, [1]);
    expect(s.list.getState().items.map((i) => i.id)).toEqual([1, 2, 3]);
    expect(s.notes[0]).toMatchObject({ message: "Couldn't change the category. Try again.", level: "error" });
  });
});

describe("category menu items", () => {
  it("lists the other two categories and runs the category action", () => {
    const run = vi.fn();
    const items = categoryMenuItems("notifications", run);
    expect(items.map((i) => ("label" in i ? i.label : ""))).toEqual(["Move to People", "Move to Newsletters"]);
    for (const i of items) if (!("type" in i)) i.onSelect();
    expect(run.mock.calls).toEqual([[{ type: "category", category: "people" }], [{ type: "category", category: "newsletters" }]]);
  });

  it("sits in the row context menu with the row's own category left out", () => {
    const h = { run: vi.fn(), snooze: vi.fn(), move: vi.fn(), reply: vi.fn(), block: vi.fn() };
    const labels = rowMenuItems(item(1, { category: "newsletters" }), [1], h, true).map((i) => ("label" in i ? i.label : "-"));
    expect(labels).toContain("Move to People");
    expect(labels).toContain("Move to Notifications");
    expect(labels).not.toContain("Move to Newsletters");
  });
});
