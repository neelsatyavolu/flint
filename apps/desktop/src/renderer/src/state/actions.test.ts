import { describe, expect, it, vi } from "vitest";
import type { Settings } from "@flint/core";
import { actionMessage, performAction, pickAdvance, removesFromView, undoLast, type ActionDeps } from "./actions";
import { createListStore } from "./listStore";
import { createNavStore } from "./nav";
import { item } from "./testFixtures";

const ITEMS = [item(1), item(2, { unreadCount: 1 }), item(3)];

function setup(over: { view?: "inbox" | "pinned"; failWith?: Error; afterArchive?: Settings["inbox"]["afterArchive"] } = {}) {
  const api = {
    archive: vi.fn(async () => ({ undoToken: "u1" })),
    trash: vi.fn(async () => ({ undoToken: "u2" })),
    markSpam: vi.fn(async () => ({ undoToken: "u3" })),
    setPinned: vi.fn(async () => ({ undoToken: "u4" })),
    markRead: vi.fn(async () => ({ undoToken: "u5" })),
    setMuted: vi.fn(async () => ({ undoToken: "u6" })),
    snooze: vi.fn(async () => ({ undoToken: "u7" })),
    unsnooze: vi.fn(async () => ({ undoToken: "u8" })),
    moveToFolder: vi.fn(async () => ({ undoToken: "u9" })),
    moveToInbox: vi.fn(async () => ({ undoToken: "u10" })),
    undo: vi.fn(async () => undefined),
  };
  if (over.failWith) for (const k of Object.keys(api) as (keyof typeof api)[]) if (k !== "undo") api[k].mockRejectedValue(over.failWith);
  const list = createListStore({ listThreads: async () => ({ items: ITEMS, bundles: [], nextCursor: null }) });
  const nav = createNavStore();
  const notes: { message: string; action?: { label: string; onClick: () => void }; level?: string }[] = [];
  const deps: ActionDeps = {
    api, list, nav,
    notify: (t) => notes.push(t),
    getSettings: () => ({ inbox: { afterArchive: over.afterArchive ?? "next" } }) as Settings,
  };
  nav.getState().go({ view: over.view ?? "inbox" });
  return { api, list, nav, deps, notes };
}

async function loaded(s: ReturnType<typeof setup>) {
  s.list.getState().setQuery({ view: "inbox" });
  await vi.waitFor(() => expect(s.list.getState().status).toBe("ready"));
}

describe("removesFromView / actionMessage", () => {
  it("knows which actions empty a row", () => {
    expect(removesFromView({ type: "archive" }, { view: "inbox" })).toBe(true);
    expect(removesFromView({ type: "archive" }, { view: "sent" })).toBe(false);
    expect(removesFromView({ type: "trash" }, { view: "trash" })).toBe(false);
    expect(removesFromView({ type: "pin", pinned: false }, { view: "pinned" })).toBe(true);
    expect(removesFromView({ type: "pin", pinned: true }, { view: "pinned" })).toBe(false);
    expect(removesFromView({ type: "move", folderId: 2, folderName: "X" }, { view: "folder", folderId: 2 })).toBe(false);
    expect(removesFromView({ type: "move", folderId: 3, folderName: "X" }, { view: "folder", folderId: 2 })).toBe(true);
    expect(removesFromView({ type: "snooze", until: 1 }, { view: "inbox" })).toBe(true);
    expect(removesFromView({ type: "unsnooze" }, { view: "snoozed" })).toBe(true);
    expect(removesFromView({ type: "spam", spam: false }, { view: "spam" })).toBe(true);
    expect(removesFromView({ type: "inbox" }, { view: "archive" })).toBe(true);
    expect(removesFromView({ type: "read", read: true }, { view: "inbox" })).toBe(false);
  });

  it("words the toasts", () => {
    expect(actionMessage({ type: "archive" }, 1)).toBe("Archived");
    expect(actionMessage({ type: "archive" }, 3)).toBe("Archived 3 conversations");
    expect(actionMessage({ type: "trash" }, 1)).toBe("Moved to Trash");
    expect(actionMessage({ type: "move", folderId: 1, folderName: "Receipts" }, 1)).toBe("Moved to Receipts");
    expect(actionMessage({ type: "pin", pinned: true }, 1)).toBeNull();
    expect(actionMessage({ type: "spam", spam: true }, 2)).toBe("Marked 2 conversations as spam");
    expect(actionMessage({ type: "mute", muted: true }, 1)).toBe("Muted");
    expect(actionMessage({ type: "inbox" }, 1)).toBe("Moved to Inbox");
    expect(actionMessage({ type: "unsnooze" }, 1)).toBe("Snooze removed");
    expect(actionMessage({ type: "snooze", until: new Date(2026, 9, 26, 9).getTime() }, 1, new Date(2026, 9, 25, 9).getTime())).toMatch(/^Snoozed until/);
  });
});

describe("pickAdvance", () => {
  it("picks the next, previous or nothing", () => {
    expect(pickAdvance(ITEMS, 2, [2], "next")).toBe(3);
    expect(pickAdvance(ITEMS, 2, [2], "previous")).toBe(1);
    expect(pickAdvance(ITEMS, 2, [2], "list")).toBeNull();
    expect(pickAdvance(ITEMS, 3, [3], "next")).toBe(2);
    expect(pickAdvance(ITEMS, 1, [1], "previous")).toBe(2);
    expect(pickAdvance(ITEMS, 2, [2, 3], "next")).toBe(1);
    expect(pickAdvance(ITEMS, 99, [99], "next")).toBeNull();
  });
});

describe("performAction", () => {
  it("removes the row at once, advances, calls the API and offers undo", async () => {
    const s = setup();
    await loaded(s);
    s.nav.getState().openThread(2);
    const p = performAction(s.deps, { type: "archive" }, [2]);
    expect(s.list.getState().items.map((i) => i.id)).toEqual([1, 3]);
    expect(s.nav.getState().openId).toBe(3);
    await p;
    expect(s.api.archive).toHaveBeenCalledWith([2]);
    expect(s.nav.getState().lastUndoToken).toBe("u1");
    expect(s.notes[0]?.message).toBe("Archived");
    s.notes[0]?.action?.onClick();
    await vi.waitFor(() => expect(s.api.undo).toHaveBeenCalledWith("u1"));
  });

  it("ignores local-only draft rows (negative ids) for thread actions", async () => {
    const s = setup();
    await loaded(s);
    await performAction(s.deps, { type: "archive" }, [-7]);
    expect(s.api.archive).not.toHaveBeenCalled();
    await performAction(s.deps, { type: "archive" }, [-7, 2]);
    expect(s.api.archive).toHaveBeenCalledWith([2]);
  });

  it("closes the reader when afterArchive is list", async () => {
    const s = setup({ afterArchive: "list" });
    await loaded(s);
    s.nav.getState().openThread(2);
    await performAction(s.deps, { type: "archive" }, [2]);
    expect(s.nav.getState().openId).toBeNull();
  });

  it("applies pin optimistically and does not toast", async () => {
    const s = setup();
    await loaded(s);
    const p = performAction(s.deps, { type: "pin", pinned: true }, [1]);
    expect(s.list.getState().items[0]?.pinned).toBe(true);
    await p;
    expect(s.notes).toEqual([]);
  });

  it("reverts and reports when the API fails", async () => {
    const s = setup({ failWith: new Error("down") });
    await loaded(s);
    await performAction(s.deps, { type: "pin", pinned: true }, [1]);
    expect(s.list.getState().items[0]?.pinned).toBe(false);
    expect(s.notes[0]).toMatchObject({ message: "Couldn't change the pin. Try again.", level: "error" });
  });

  it("brings a removed row back when the API fails", async () => {
    const s = setup({ failWith: new Error("down") });
    await loaded(s);
    await performAction(s.deps, { type: "trash" }, [3]);
    expect(s.list.getState().items.map((i) => i.id)).toEqual([1, 2, 3]);
    expect(s.notes[0]?.level).toBe("error");
  });

  it("marks read optimistically", async () => {
    const s = setup();
    await loaded(s);
    const p = performAction(s.deps, { type: "read", read: true }, [2]);
    expect(s.list.getState().items[1]?.unreadCount).toBe(0);
    await p;
  });

  it("does nothing for no ids and drops the selection of removed rows", async () => {
    const s = setup();
    await loaded(s);
    await performAction(s.deps, { type: "archive" }, []);
    expect(s.api.archive).not.toHaveBeenCalled();
    s.nav.getState().setSelected([1, 2]);
    await performAction(s.deps, { type: "archive" }, [1]);
    expect(s.nav.getState().selected).toEqual([2]);
  });

  it("covers the remaining action types", async () => {
    const s = setup();
    await loaded(s);
    for (const a of [
      { type: "spam", spam: true }, { type: "mute", muted: true }, { type: "snooze", until: Date.now() + 1000 },
      { type: "unsnooze" }, { type: "move", folderId: 4, folderName: "X" }, { type: "inbox" },
    ] as const) await performAction(s.deps, a, [1]);
    expect(s.api.markSpam).toHaveBeenCalled();
    expect(s.api.setMuted).toHaveBeenCalled();
    expect(s.api.snooze).toHaveBeenCalled();
    expect(s.api.unsnooze).toHaveBeenCalled();
    expect(s.api.moveToFolder).toHaveBeenCalledWith([1], 4);
    expect(s.api.moveToInbox).toHaveBeenCalled();
  });
});

describe("undoLast", () => {
  it("runs the stored token once", async () => {
    const s = setup();
    s.nav.getState().setLastUndo("tok");
    await undoLast(s.deps);
    expect(s.api.undo).toHaveBeenCalledWith("tok");
    expect(s.notes[0]?.message).toBe("Undone");
    await undoLast(s.deps);
    expect(s.api.undo).toHaveBeenCalledTimes(1);
  });

  it("reports a failed undo", async () => {
    const s = setup();
    s.api.undo.mockRejectedValueOnce(new Error("expired"));
    s.nav.getState().setLastUndo("tok");
    await undoLast(s.deps);
    expect(s.notes[0]).toMatchObject({ message: "Too late to undo that.", level: "error" });
  });
});
