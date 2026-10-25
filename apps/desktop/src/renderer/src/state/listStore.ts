import { createStore, useStore, type StoreApi } from "zustand";
import type { Bundle, FlintApi, ThreadId, ThreadListItem, ThreadQuery } from "@flint/core";
import { flint } from "../lib/api";
import { buildEntries, type ListEntry } from "./grouping";

export const PAGE_SIZE = 50;
const MAX_PAGE = 200;
const MAX_REFRESH = 1000;

type ListApi = Pick<FlintApi, "listThreads"> & Partial<Pick<FlintApi, "loadOlder" | "searchServer">>;
export type ListStatus = "idle" | "loading" | "ready" | "error";
/** Progress of the server search that backs up a search with few local results. */
export type ServerSearchStatus = "idle" | "searching" | "done" | "error";

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
  /** The rows on screen belong to the list the user just left; the new one is still loading. They show dimmed so the pane never goes blank. */
  stale: boolean;
  hidden: ThreadId[];
  setQuery(query: ThreadQuery | null): void;
  refresh(): Promise<void>;
  loadMore(): Promise<void>;
  /** Pulls the next batch of older mail from the server, then shows it. */
  loadOlder(): Promise<void>;
  /** Searches the server for the current search query and merges new matches into the list. Once per query. */
  searchServer(): Promise<void>;
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
type Snapshot = { items: ThreadListItem[]; bundles: Bundle[]; nextCursor: string | null; olderOnServer: boolean };
const SNAPSHOT_LIMIT = 12;

export function createListStore(api: ListApi): ListStore {
  let seq = 0;
  const searched = new Set<string>();
  const snapshots = new Map<string, Snapshot>();

  return createStore<ListState>((set, get) => {
    const apply = (raw: ThreadListItem[], bundles: Bundle[], hidden: ThreadId[] = get().hidden) =>
      set({ raw, bundles, hidden, ...derive(raw, bundles, hidden, get().query?.sort ?? "newest") });

    const fail = (id: number, err: unknown) => {
      if (id !== seq) return;
      const wasStale = get().stale;
      set({
        status: "error", loadingMore: false, error: err instanceof Error ? err.message : String(err), stale: false,
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
      stale: false,
      hidden: [],

      setQuery(query) {
        const key = query ? queryKey(query) : null;
        if (key === get().queryKey) return;
        const left = get();
        if (left.queryKey !== null && left.status === "ready" && left.query?.view !== "search") {
          snapshots.delete(left.queryKey);
          snapshots.set(left.queryKey, { items: left.items, bundles: left.bundles, nextCursor: left.nextCursor, olderOnServer: left.olderOnServer });
          if (snapshots.size > SNAPSHOT_LIMIT) snapshots.delete(snapshots.keys().next().value as string);
        }
        const id = ++seq;
        const snap = key !== null && query?.view !== "search" ? snapshots.get(key) : undefined;
        if (snap) {
          set({
            query, queryKey: key, nextCursor: snap.nextCursor, hidden: [], loadingMore: false, error: null, olderOnServer: snap.olderOnServer,
            loadingOlder: false, olderError: null, serverSearch: "idle", status: "ready", stale: false,
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
          olderOnServer: false, loadingOlder: false, olderError: null, serverSearch: "idle", status: query ? "loading" : "idle", stale: carry,
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
          set({ nextCursor, olderOnServer: nextCursor === null && olderOnServer, status: "ready", error: null, stale: false });
          apply(reuse(get().raw, items), bundles);
        } catch (err) {
          fail(id, err);
        }
      },

      async loadMore() {
        const { query, nextCursor, loadingMore, status } = get();
        if (!query || !nextCursor || loadingMore || status !== "ready") return;
        const id = seq;
        set({ loadingMore: true });
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

      async searchServer() {
        const { query, queryKey: key, status } = get();
        if (!api.searchServer || !query || key === null || query.view !== "search" || !query.search?.trim() || status !== "ready" || searched.has(key)) return;
        searched.add(key);
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
