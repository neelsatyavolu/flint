import { createStore, useStore, type StoreApi } from "zustand";
import type { Bundle, FlintApi, ThreadId, ThreadListItem, ThreadQuery } from "@flint/core";
import { flint } from "../lib/api";
import { buildEntries, type ListEntry } from "./grouping";

export const PAGE_SIZE = 50;
const MAX_PAGE = 200;
const MAX_REFRESH = 1000;
/** A server search that already ran for a query runs again by itself only after this long; a click always runs it. */
export const SERVER_SEARCH_REPEAT_MS = 5 * 60_000;

type ListApi = Pick<FlintApi, "listThreads"> & Partial<Pick<FlintApi, "loadOlder" | "searchServer">>;
export type ListStatus = "idle" | "loading" | "ready" | "error";
/** Progress of the server search that backs up a search with few local results. */
export type ServerSearchStatus = "idle" | "searching" | "done" | "error";
/** Where the user was in a list: restored when they come back to it. */
export type ListPlace = { scrollTop: number; cursorKey: string | null };

export type ListState = {
  query: ThreadQuery | null;
  queryKey: string | null;
  /** Everything fetched, including rows hidden by an optimistic action. */
  raw: ThreadListItem[];
  /** What the list shows: raw minus hidden. */
  items: ThreadListItem[];
  bundles: Bundle[];
  entries: ListEntry[];
  nextCursor: string | null;
  status: ListStatus;
  loadingMore: boolean;
  /** The server holds older mail for this list that is not on this computer (known once the local list ends). */
  olderOnServer: boolean;
  loadingOlder: boolean;
  olderError: string | null;
  serverSearch: ServerSearchStatus;
  error: string | null;
  /** A later page or refresh failed while rows are on screen. The rows stay; the footer offers a retry. */
  pageError: string | null;
  /** Scroll position and cursor saved for the list now shown, when it was painted from a snapshot. Read once on arrival. */
  restored: ListPlace | null;
  /** The rows on screen belong to the list the user just left; the new one is still loading. They show dimmed so the pane never goes blank. */
  stale: boolean;
  hidden: ThreadId[];
  setQuery(query: ThreadQuery | null): void;
  refresh(): Promise<void>;
  loadMore(): Promise<void>;
  /** Pulls the next batch of older mail from the server, then shows it. */
  loadOlder(): Promise<void>;
  /**
   * Searches the server for the current search query and merges new matches into the list. Runs once per query every
   * few minutes, or every time when `explicit` (the user clicked).
   */
  searchServer(opts?: { explicit?: boolean }): Promise<void>;
  /** Remembers where the user is in the current list, for a later revisit. */
  savePlace(place: Partial<ListPlace>): void;
  hide(ids: ThreadId[]): void;
  /** Replaces the bundle rows (optimistic category moves). The next refresh brings the server's numbers. */
  patchBundles(fn: (bundles: Bundle[]) => Bundle[]): void;
  unhide(ids: ThreadId[]): void;
  /** Takes threads out of the remembered lists after they changed elsewhere (archived, moved, deleted), so a revisit does not flash them. */
  forgetInSnapshots(ids: ThreadId[]): void;
  patchItems(ids: ThreadId[], patch: Partial<ThreadListItem> | ((item: ThreadListItem) => Partial<ThreadListItem>)): void;
};
export type ListStore = StoreApi<ListState>;

export function queryKey(query: ThreadQuery): string {
  const { cursor: _cursor, limit: _limit, ...rest } = query;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

function sameItem(a: ThreadListItem, b: ThreadListItem): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Reuses unchanged row objects so memoized rows skip rendering after a refetch. */
function reuse(prev: ThreadListItem[], next: ThreadListItem[]): ThreadListItem[] {
  const byId = new Map(prev.map((i) => [i.id, i]));
  return next.map((i) => {
    const old = byId.get(i.id);
    return old && sameItem(old, i) ? old : i;
  });
}

function derive(raw: ThreadListItem[], bundles: Bundle[], hidden: ThreadId[], sort: "newest" | "oldest") {
  const gone = new Set(hidden);
  const items = gone.size ? raw.filter((i) => !gone.has(i.id)) : raw;
  return { items, entries: buildEntries(items, bundles, sort) };
}

/** What a list showed when the user left it, so coming back paints at once while a refresh checks for changes. */
type Snapshot = { items: ThreadListItem[]; bundles: Bundle[]; nextCursor: string | null; olderOnServer: boolean; place: ListPlace };
const SNAPSHOT_LIMIT = 12;

export function createListStore(api: ListApi, now: () => number = Date.now): ListStore {
  let seq = 0;
  /** When each search query last asked the server. */
  const searched = new Map<string, number>();
  const snapshots = new Map<string, Snapshot>();
  let place: ListPlace = { scrollTop: 0, cursorKey: null };

  return createStore<ListState>((set, get) => {
    const apply = (raw: ThreadListItem[], bundles: Bundle[], hidden: ThreadId[] = get().hidden) =>
      set({ raw, bundles, hidden, ...derive(raw, bundles, hidden, get().query?.sort ?? "newest") });

    const fail = (id: number, err: unknown) => {
      if (id !== seq) return;
      const { stale: wasStale, raw } = get();
      const message = err instanceof Error ? err.message : String(err);
      // Rows of this list are on screen: keep them, and let the footer retry what failed.
      if (!wasStale && raw.length > 0) {
        set({ status: "ready", loadingMore: false, pageError: message });
        return;
      }
      set({
        status: "error", loadingMore: false, error: message, stale: false,
        ...(wasStale ? { raw: [], items: [], bundles: [], entries: [], nextCursor: null } : {}),
      });
    };

    return {
      query: null,
      queryKey: null,
      raw: [],
      items: [],
      bundles: [],
      entries: [],
      nextCursor: null,
      status: "idle",
      loadingMore: false,
      olderOnServer: false,
      loadingOlder: false,
      olderError: null,
      serverSearch: "idle",
      error: null,
      pageError: null,
      restored: null,
      stale: false,
      hidden: [],

      setQuery(query) {
        const key = query ? queryKey(query) : null;
        if (key === get().queryKey) return;
        const left = get();
        if (left.queryKey !== null && left.status === "ready" && left.query?.view !== "search") {
          snapshots.delete(left.queryKey);
          snapshots.set(left.queryKey, { items: left.items, bundles: left.bundles, nextCursor: left.nextCursor, olderOnServer: left.olderOnServer, place });
          if (snapshots.size > SNAPSHOT_LIMIT) snapshots.delete(snapshots.keys().next().value as string);
        }
        const id = ++seq;
        const snap = key !== null && query?.view !== "search" ? snapshots.get(key) : undefined;
        place = snap?.place ?? { scrollTop: 0, cursorKey: null };
        if (snap) {
          set({
            query, queryKey: key, nextCursor: snap.nextCursor, hidden: [], loadingMore: false, error: null, pageError: null, olderOnServer: snap.olderOnServer,
            loadingOlder: false, olderError: null, serverSearch: "idle", status: "ready", stale: false, restored: snap.place,
          });
          apply(snap.items, snap.bundles, []);
          void get().refresh();
          return;
        }
        // Typing in search keeps the previous results on screen until the new ones arrive, so the list never blinks per keystroke.
        const typing = query?.view === "search" && left.query?.view === "search";
        // Switching to a list not seen yet keeps the old rows, dimmed, until the new ones arrive, instead of a blank pane.
        const carry = !typing && query !== null && query.view !== "search" && left.status === "ready" && left.raw.length > 0;
        set({
          query, queryKey: key, ...(typing || carry ? {} : { raw: [], items: [], bundles: [], entries: [], nextCursor: null }), hidden: [], loadingMore: false, error: null,
          pageError: null, restored: null, olderOnServer: false, loadingOlder: false, olderError: null, serverSearch: "idle", status: query ? "loading" : "idle", stale: carry,
        });
        if (!query) return;
        api.listThreads({ ...query, limit: PAGE_SIZE }).then((page) => {
          if (id !== seq) return;
          set({ nextCursor: page.nextCursor, olderOnServer: page.olderOnServer === true, status: "ready", stale: false });
          apply(page.items, page.bundles, []);
        }, (err: unknown) => fail(id, err));
      },

      async refresh() {
        const { query, raw } = get();
        if (!query) return;
        const id = ++seq;
        set({ loadingMore: false });
        const want = Math.min(Math.max(raw.length, PAGE_SIZE), MAX_REFRESH);
        try {
          let items: ThreadListItem[] = [];
          let bundles: Bundle[] = [];
          let cursor: string | undefined;
          let nextCursor: string | null = null;
          let olderOnServer = false;
          do {
            const page = await api.listThreads({ ...query, limit: Math.min(MAX_PAGE, want - items.length), ...(cursor ? { cursor } : {}) });
            if (id !== seq) return;
            items = [...items, ...page.items];
            if (!cursor) bundles = page.bundles;
            nextCursor = page.nextCursor;
            olderOnServer = page.olderOnServer === true;
            cursor = page.nextCursor ?? undefined;
          } while (cursor && items.length < want);
          set({ nextCursor, olderOnServer: nextCursor === null && olderOnServer, status: "ready", error: null, pageError: null, stale: false });
          apply(reuse(get().raw, items), bundles);
        } catch (err) {
          fail(id, err);
        }
      },

      async loadMore() {
        const { query, nextCursor, loadingMore, status } = get();
        if (!query || !nextCursor || loadingMore || status !== "ready") return;
        const id = seq;
        set({ loadingMore: true, pageError: null });
        try {
          const page = await api.listThreads({ ...query, limit: PAGE_SIZE, cursor: nextCursor });
          if (id !== seq) return;
          const have = new Set(get().raw.map((i) => i.id));
          set({ nextCursor: page.nextCursor, olderOnServer: page.olderOnServer === true, loadingMore: false });
          apply([...get().raw, ...page.items.filter((i) => !have.has(i.id))], get().bundles);
        } catch (err) {
          fail(id, err);
        }
      },

      async loadOlder() {
        const { query, queryKey: key, loadingOlder, status } = get();
        if (!api.loadOlder || !query || loadingOlder || status !== "ready") return;
        set({ loadingOlder: true, olderError: null });
        try {
          await api.loadOlder(query);
          if (get().queryKey !== key) return;
          await get().refresh();
          if (get().queryKey !== key) return;
          set({ loadingOlder: false });
          await get().loadMore();
        } catch (err) {
          if (get().queryKey === key) set({ loadingOlder: false, olderError: err instanceof Error ? err.message : String(err) });
        }
      },

      async searchServer(opts) {
        const { query, queryKey: key, status, serverSearch } = get();
        if (!api.searchServer || !query || key === null || query.view !== "search" || !query.search?.trim() || status !== "ready" || serverSearch === "searching") return;
        const last = searched.get(key);
        if (!opts?.explicit && last !== undefined && now() - last < SERVER_SEARCH_REPEAT_MS) return;
        searched.set(key, now());
        set({ serverSearch: "searching" });
        try {
          const result = await api.searchServer(query.search, query.accountId);
          if (get().queryKey !== key) return;
          set({ serverSearch: "done" });
          if (result.added > 0) await get().refresh();
        } catch {
          searched.delete(key);
          if (get().queryKey === key) set({ serverSearch: "error" });
        }
      },

      savePlace(patch) {
        place = { ...place, ...patch };
      },

      patchBundles(fn) {
        apply(get().raw, fn(get().bundles));
      },

      hide(ids) {
        apply(get().raw, get().bundles, [...new Set([...get().hidden, ...ids])]);
      },

      unhide(ids) {
        const drop = new Set(ids);
        apply(get().raw, get().bundles, get().hidden.filter((id) => !drop.has(id)));
      },

      forgetInSnapshots(ids) {
        if (ids.length === 0) return;
        const gone = new Set(ids);
        for (const [key, snap] of snapshots) {
          if (snap.items.some((i) => gone.has(i.id))) snapshots.set(key, { ...snap, items: snap.items.filter((i) => !gone.has(i.id)) });
        }
      },

      patchItems(ids, patch) {
        const target = new Set(ids);
        const raw = get().raw.map((i) => (target.has(i.id) ? { ...i, ...(typeof patch === "function" ? patch(i) : patch) } : i));
        apply(raw, get().bundles);
      },
    };
  });
}

export const listStore: ListStore = createListStore(flint);

export function useList<T>(selector: (s: ListState) => T): T {
  return useStore(listStore, selector);
}
