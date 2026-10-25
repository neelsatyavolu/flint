import { describe, expect, it, vi } from "vitest";
import { applyHint, searchHints } from "./searchHints";
import { emptyCopy, isMailView, viewSubtitle, viewTitle } from "./viewMeta";
import { rowHeight } from "./rowMetrics";
import { scheduleMarkRead, READ_DELAY_MS } from "./readOnOpen";
import { createListStore } from "./listStore";
import { item } from "./testFixtures";
import type { Account, Folder } from "@flint/core";

const nav = { view: "inbox" as const, accountId: undefined, folderId: undefined, category: undefined, search: "", searchOpen: false };

describe("searchHints", () => {
  it("lists all operators for empty input and filters by prefix", () => {
    expect(searchHints("").length).toBeGreaterThan(8);
    expect(searchHints("hello fr").map((h) => h.token)).toEqual(["from:"]);
    expect(searchHints("from:")).toEqual([]);
    expect(applyHint("hello fr", { token: "from:", description: "" })).toBe("hello from:");
  });
});

describe("viewMeta", () => {
  const folders = [{ id: 4, name: "Receipts" }] as Folder[];
  const accounts = [{ id: "a1", email: "a@x.test" }, { id: "a2", email: "b@x.test" }] as Account[];
  it("titles", () => {
    expect(viewTitle(nav)).toBe("Inbox");
    expect(viewTitle({ ...nav, category: "newsletters" })).toBe("Newsletters");
    expect(viewTitle({ ...nav, view: "folder", folderId: 4 }, folders)).toBe("Receipts");
    expect(viewTitle({ ...nav, searchOpen: true, search: "x" })).toBe("Search");
    expect(viewTitle({ ...nav, view: "receipts" })).toBe("Read Statuses");
  });
  it("subtitles", () => {
    expect(viewSubtitle(nav, true, accounts)).toBe("Focused · All accounts");
    expect(viewSubtitle({ ...nav, accountId: "a2" }, false, accounts)).toBe("All mail · b@x.test");
    expect(viewSubtitle(nav, true, [accounts[0]!])).toBe("Focused");
    expect(viewSubtitle({ ...nav, view: "sent" }, true, accounts)).toBe("All accounts");
    expect(viewSubtitle({ ...nav, searchOpen: true, search: "q" }, true, [])).toBe("All mail");
  });
  it("empty copy per view", () => {
    expect(emptyCopy(nav).title).toBe("Inbox zero.");
    for (const view of ["pinned", "drafts", "sent", "trash", "spam", "archive", "snoozed", "blocked", "folder", "home"] as const) {
      expect(emptyCopy({ ...nav, view }).title).toBeTruthy();
    }
    expect(emptyCopy({ ...nav, category: "newsletters" }).title).toBe("No newsletters.");
    expect(emptyCopy({ ...nav, searchOpen: true, search: "zz" }).title).toBe('No results for "zz"');
  });
  it("knows list views", () => {
    expect(isMailView("inbox")).toBe(true);
    expect(isMailView("home")).toBe(false);
  });
});

describe("rowHeight", () => {
  it("follows density and preview lines", () => {
    expect(rowHeight("comfortable", 1)).toBe(76);
    expect(rowHeight("comfortable", 2)).toBe(96);
    expect(rowHeight("comfortable", 0)).toBe(56);
    expect(rowHeight("compact", 2)).toBe(56);
  });
});

describe("scheduleMarkRead", () => {
  const setup = () => {
    const list = createListStore({ listThreads: async () => ({ items: [item(1, { unreadCount: 2 })], bundles: [], nextCursor: null }) });
    list.getState().setQuery({ view: "inbox" });
    return list;
  };
  it("marks read at once in instant mode", async () => {
    const list = setup();
    await vi.waitFor(() => expect(list.getState().status).toBe("ready"));
    const api = { markRead: vi.fn(async () => ({ undoToken: "t" })) };
    scheduleMarkRead({ api, list }, "instant", 1);
    expect(api.markRead).toHaveBeenCalledWith([1], true);
    expect(list.getState().items[0]?.unreadCount).toBe(0);
  });
  it("waits in delay mode and can be cancelled", async () => {
    vi.useFakeTimers();
    const list = createListStore({ listThreads: async () => ({ items: [item(1, { unreadCount: 1 })], bundles: [], nextCursor: null }) });
    list.getState().setQuery({ view: "inbox" });
    await vi.advanceTimersByTimeAsync(0);
    const api = { markRead: vi.fn(async () => ({ undoToken: "t" })) };
    const cancel = scheduleMarkRead({ api, list }, "delay", 1);
    cancel();
    vi.advanceTimersByTime(READ_DELAY_MS + 10);
    expect(api.markRead).not.toHaveBeenCalled();
    scheduleMarkRead({ api, list }, "delay", 1);
    vi.advanceTimersByTime(READ_DELAY_MS + 10);
    expect(api.markRead).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
  it("never mode and already-read rows do nothing; failure restores the count", async () => {
    const list = setup();
    await vi.waitFor(() => expect(list.getState().status).toBe("ready"));
    const api = { markRead: vi.fn(async () => { throw new Error("x"); }) };
    scheduleMarkRead({ api, list }, "never", 1);
    expect(api.markRead).not.toHaveBeenCalled();
    scheduleMarkRead({ api, list }, "instant", 1);
    await vi.waitFor(() => expect(list.getState().items[0]?.unreadCount).toBe(2));
    list.getState().patchItems([1], { unreadCount: 0 });
    scheduleMarkRead({ api, list }, "instant", 1);
    expect(api.markRead).toHaveBeenCalledTimes(1);
  });
});
