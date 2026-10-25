import { createStore, useStore, type StoreApi } from "zustand";
import type { AccountId, Category, FolderId, Settings, ThreadId, ThreadQuery, View } from "@flint/core";
import { readStored, writeStored } from "../lib/storage";
import { bundleKey, threadKey } from "./grouping";

export type NavView = Exclude<View, "search">;
export type Overlay = "palette" | "shortcuts" | "snooze" | "move" | null;
export type Recent = { id: string; label: string; view: NavView; accountId?: AccountId; folderId?: FolderId };
export type NavTarget = { view: NavView; accountId?: AccountId; folderId?: FolderId; category?: Category };

const RECENTS_KEY = "flint.recents";
const COLLAPSED_KEY = "flint.sidebarCollapsed";
const MAX_RECENTS = 5;

function loadRecents(): Recent[] {
  try {
    const parsed: unknown = JSON.parse(readStored(RECENTS_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as Recent[]).filter((r) => typeof r?.id === "string" && typeof r?.label === "string").slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

export function recentId(t: NavTarget): string {
  return [t.view, t.accountId ?? "", t.folderId ?? ""].join(":");
}

/** Most recent first, deduplicated, capped. */
export function pushRecent(list: Recent[], item: Recent, max: number = MAX_RECENTS): Recent[] {
  return [item, ...list.filter((r) => r.id !== item.id)].slice(0, max);
}

export type NavState = NavTarget & {
  search: string;
  searchOpen: boolean;
  settingsOpen: boolean;
  settingsSection: string | undefined;
  /** The thread shown in the reader. */
  openId: ThreadId | null;
  /** Keyboard cursor: a row key ("t12" or "b:newsletters"). */
  cursorKey: string | null;
  selected: ThreadId[];
  sidebarCollapsed: boolean;
  narrowExpanded: boolean;
  expanded: Record<string, boolean>;
  recents: Recent[];
  overlay: Overlay;
  overlayIds: ThreadId[];
  lastUndoToken: string | null;

  go(target: NavTarget, recentLabel?: string): void;
  openCategory(category: Category): void;
  closeCategory(): void;
  setSearch(search: string): void;
  openSearch(): void;
  closeSearch(): void;
  openSettings(section?: string): void;
  closeSettings(): void;
  openThread(id: ThreadId | null, opts?: { fromOutside?: boolean }): void;
  setCursor(key: string | null): void;
  toggleSelected(id: ThreadId): void;
  setSelected(ids: ThreadId[]): void;
  clearSelected(): void;
  toggleSidebar(narrow: boolean): void;
  toggleExpanded(key: string): void;
  clearRecents(): void;
  showOverlay(overlay: Exclude<Overlay, null>, ids?: ThreadId[]): void;
  closeOverlay(): void;
  setLastUndo(token: string | null): void;
};

export type NavStore = StoreApi<NavState>;

export function createNavStore(): NavStore {
  return createStore<NavState>((set, get) => ({
    view: "inbox",
    accountId: undefined,
    folderId: undefined,
    category: undefined,
    search: "",
    searchOpen: false,
    settingsOpen: false,
    settingsSection: undefined,
    openId: null,
    cursorKey: null,
    selected: [],
    sidebarCollapsed: readStored(COLLAPSED_KEY) === "1",
    narrowExpanded: false,
    expanded: { inbox: true },
    recents: loadRecents(),
    overlay: null,
    overlayIds: [],
    lastUndoToken: null,

    go(target, recentLabel) {
      const recents = recentLabel ? pushRecent(get().recents, { id: recentId(target), label: recentLabel, view: target.view, accountId: target.accountId, folderId: target.folderId }) : get().recents;
      if (recents !== get().recents) writeStored(RECENTS_KEY, JSON.stringify(recents));
      set({
        view: target.view, accountId: target.accountId, folderId: target.folderId, category: target.category,
        search: "", searchOpen: false, settingsOpen: false, openId: null, cursorKey: null, selected: [], recents,
      });
    },
    openCategory(category) {
      set({ category, openId: null, cursorKey: null, selected: [], view: "inbox", settingsOpen: false });
    },
    closeCategory() {
      set({ category: undefined, openId: null, cursorKey: null, selected: [] });
    },
    setSearch(search) {
      set({ search, openId: null, cursorKey: null, selected: [] });
    },
    openSearch() {
      set({ searchOpen: true, settingsOpen: false });
    },
    closeSearch() {
      set({ searchOpen: false, search: "", openId: null, cursorKey: null, selected: [] });
    },
    openSettings(section) {
      set({ settingsOpen: true, settingsSection: section });
    },
    closeSettings() {
      set({ settingsOpen: false, settingsSection: undefined });
    },
    openThread(id, opts) {
      if (opts?.fromOutside && id !== null) {
        set({ view: "inbox", accountId: undefined, folderId: undefined, category: undefined, search: "", searchOpen: false, settingsOpen: false, openId: id, cursorKey: threadKey(id), selected: [] });
        return;
      }
      set({ openId: id, cursorKey: id === null ? get().cursorKey : threadKey(id), selected: [] });
    },
    setCursor(key) {
      set({ cursorKey: key });
    },
    toggleSelected(id) {
      const { selected, openId } = get();
      const base = selected.length === 0 && openId !== null && openId !== id ? [openId] : selected;
      set({ selected: base.includes(id) ? base.filter((x) => x !== id) : [...base, id] });
    },
    setSelected(ids) {
      set({ selected: ids });
    },
    clearSelected() {
      if (get().selected.length) set({ selected: [] });
    },
    toggleSidebar(narrow) {
      if (narrow) {
        set({ narrowExpanded: !get().narrowExpanded });
        return;
      }
      const next = !get().sidebarCollapsed;
      writeStored(COLLAPSED_KEY, next ? "1" : "0");
      set({ sidebarCollapsed: next });
    },
    toggleExpanded(key) {
      set({ expanded: { ...get().expanded, [key]: !get().expanded[key] } });
    },
    clearRecents() {
      writeStored(RECENTS_KEY, "[]");
      set({ recents: [] });
    },
    showOverlay(overlay, ids = []) {
      set({ overlay, overlayIds: ids });
    },
    closeOverlay() {
      set({ overlay: null, overlayIds: [] });
    },
    setLastUndo(token) {
      set({ lastUndoToken: token });
    },
  }));
}

export const navStore: NavStore = createNavStore();

export function useNav<T>(selector: (s: NavState) => T): T {
  return useStore(navStore, selector);
}

/** The list query for the current navigation, or null for views that are not thread lists. */
export function buildQuery(nav: Pick<NavState, "view" | "accountId" | "folderId" | "category" | "search" | "searchOpen">, settings: Pick<Settings, "inbox"> | undefined): ThreadQuery | null {
  const sort = settings?.inbox.sort ?? "newest";
  const trimmed = nav.search.trim();
  if (nav.searchOpen && trimmed) return { view: "search", search: trimmed, accountId: nav.accountId, sort };
  switch (nav.view) {
    case "home":
    case "receipts":
    case "agent_activity":
    case "scheduled":
      return null;
    case "inbox":
      return { view: "inbox", accountId: nav.accountId, focused: nav.category ? undefined : settings?.inbox.focused ?? true, category: nav.category, sort };
    case "folder":
      return nav.folderId === undefined ? null : { view: "folder", accountId: nav.accountId, folderId: nav.folderId, sort };
    default:
      return { view: nav.view, accountId: nav.accountId, sort };
  }
}

/** Threads an action applies to: the multi-selection, else the open thread, else the cursor row. */
export function targetIds(nav: Pick<NavState, "selected" | "openId" | "cursorKey">): ThreadId[] {
  if (nav.selected.length) return nav.selected;
  if (nav.openId !== null) return [nav.openId];
  const key = nav.cursorKey;
  if (key?.startsWith("t")) {
    const id = Number(key.slice(1));
    if (Number.isFinite(id)) return [id];
  }
  return [];
}

export { bundleKey, threadKey };
