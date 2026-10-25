import { describe, expect, it } from "vitest";
import type { Settings } from "@flint/core";
import { buildQuery, createNavStore, pushRecent, recentId, targetIds, type Recent } from "./nav";

const settings = { inbox: { focused: true, sort: "newest" } } as Settings;

describe("nav store", () => {
  it("go resets thread state and records recents", () => {
    const nav = createNavStore();
    nav.getState().openThread(5);
    nav.getState().go({ view: "folder", accountId: "a1", folderId: 9 }, "Receipts");
    const s = nav.getState();
    expect(s).toMatchObject({ view: "folder", folderId: 9, openId: null, selected: [], settingsOpen: false });
    expect(s.recents[0]).toMatchObject({ label: "Receipts", folderId: 9 });
    nav.getState().clearRecents();
    expect(nav.getState().recents).toEqual([]);
  });

  it("opens and closes a category", () => {
    const nav = createNavStore();
    nav.getState().go({ view: "sent" });
    nav.getState().openCategory("newsletters");
    expect(nav.getState()).toMatchObject({ view: "inbox", category: "newsletters" });
    nav.getState().closeCategory();
    expect(nav.getState().category).toBeUndefined();
  });

  it("opening from a notification jumps to the inbox", () => {
    const nav = createNavStore();
    nav.getState().go({ view: "sent" });
    nav.getState().openThread(8, { fromOutside: true });
    expect(nav.getState()).toMatchObject({ view: "inbox", openId: 8, cursorKey: "t8" });
  });

  it("toggling selection starts from the open thread", () => {
    const nav = createNavStore();
    nav.getState().openThread(1);
    nav.getState().toggleSelected(2);
    expect(nav.getState().selected).toEqual([1, 2]);
    nav.getState().toggleSelected(1);
    expect(nav.getState().selected).toEqual([2]);
    nav.getState().clearSelected();
    expect(nav.getState().selected).toEqual([]);
  });

  it("search open and close", () => {
    const nav = createNavStore();
    nav.getState().openSearch();
    nav.getState().setSearch("from:carla");
    expect(nav.getState().searchOpen).toBe(true);
    nav.getState().closeSearch();
    expect(nav.getState()).toMatchObject({ searchOpen: false, search: "" });
  });

  it("settings and overlays", () => {
    const nav = createNavStore();
    nav.getState().openSettings("agents");
    expect(nav.getState()).toMatchObject({ settingsOpen: true, settingsSection: "agents" });
    nav.getState().closeSettings();
    nav.getState().showOverlay("snooze", [3]);
    expect(nav.getState()).toMatchObject({ overlay: "snooze", overlayIds: [3] });
    nav.getState().closeOverlay();
    expect(nav.getState().overlay).toBeNull();
  });

  it("sidebar toggles per mode and expands sections", () => {
    const nav = createNavStore();
    const before = nav.getState().sidebarCollapsed;
    nav.getState().toggleSidebar(false);
    expect(nav.getState().sidebarCollapsed).toBe(!before);
    nav.getState().toggleSidebar(true);
    expect(nav.getState().narrowExpanded).toBe(true);
    nav.getState().toggleExpanded("trash");
    expect(nav.getState().expanded.trash).toBe(true);
  });

  it("deduplicates and caps recents", () => {
    const mk = (n: number): Recent => ({ id: `r${n}`, label: `R${n}`, view: "folder" });
    let list = [mk(1), mk(2)];
    list = pushRecent(list, mk(1));
    expect(list.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(pushRecent([mk(1), mk(2), mk(3)], mk(4), 3).map((r) => r.id)).toEqual(["r4", "r1", "r2"]);
    expect(recentId({ view: "folder", accountId: "a", folderId: 2 })).toBe("folder:a:2");
  });
});

describe("buildQuery", () => {
  const base = { view: "inbox" as const, accountId: undefined, folderId: undefined, category: undefined, search: "", searchOpen: false };
  it("uses focused for the inbox and not inside a bundle", () => {
    expect(buildQuery(base, settings)).toMatchObject({ view: "inbox", focused: true });
    expect(buildQuery({ ...base, category: "newsletters" }, settings)).toMatchObject({ category: "newsletters", focused: undefined });
  });
  it("searches when text is entered", () => {
    expect(buildQuery({ ...base, searchOpen: true, search: " from:a " }, settings)).toMatchObject({ view: "search", search: "from:a" });
    expect(buildQuery({ ...base, searchOpen: true, search: "  " }, settings)?.view).toBe("inbox");
  });
  it("returns null for non-list views and folder without id", () => {
    for (const view of ["home", "receipts", "agent_activity", "scheduled"] as const) expect(buildQuery({ ...base, view }, settings)).toBeNull();
    expect(buildQuery({ ...base, view: "folder" }, settings)).toBeNull();
    expect(buildQuery({ ...base, view: "folder", folderId: 4 }, settings)).toMatchObject({ view: "folder", folderId: 4 });
    expect(buildQuery({ ...base, view: "sent", accountId: "a1" }, undefined)).toMatchObject({ view: "sent", accountId: "a1", sort: "newest" });
  });
});

describe("targetIds", () => {
  it("prefers the selection, then the open thread, then the cursor", () => {
    expect(targetIds({ selected: [1, 2], openId: 3, cursorKey: "t4" })).toEqual([1, 2]);
    expect(targetIds({ selected: [], openId: 3, cursorKey: "t4" })).toEqual([3]);
    expect(targetIds({ selected: [], openId: null, cursorKey: "t4" })).toEqual([4]);
    expect(targetIds({ selected: [], openId: null, cursorKey: "b:newsletters" })).toEqual([]);
    expect(targetIds({ selected: [], openId: null, cursorKey: null })).toEqual([]);
  });
});
