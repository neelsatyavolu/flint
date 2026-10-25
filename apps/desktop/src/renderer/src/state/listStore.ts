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
  hidden: ThreadId[];
  setQuery(query: ThreadQuery | null): void;
  refresh(): Promise<void>;
  loadMore(): Promise<void>;
  /** Pulls the next batch of older mail from the server, then shows it. */
  loadOlder(): Promise<void>;
  /** Searches the server for the current search query and merges new matches into the list. Once per query. */
  searchServer(): Promise<void>;
  hide(ids: ThreadId[]): void;
  unhide(ids: ThreadId[]): void;
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

export function createListStore(api: ListApi): ListStore {
  let seq = 0;
  const searched = new Set<string>();

  return createStore<ListState>((set, get) => {
    const apply = (raw: ThreadListItem[], bundles: Bundle[], hidden: ThreadId[] = get().hidden) =>
      set({ raw, bundles, hidden, ...derive(raw, bundles, hidden, get().query?.sort ?? "newest") });

    const fail = (id: number, err: unknown) => {
      if (id !== seq) return;
      set({ status: "error", loadingMore: false, error: err instanceof Error ? err.message : String(err) });
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
      hidden: [],

      setQuery(query) {
        const key = query ? queryKey(query) : null;
        if (key === get().queryKey) return;
        const id = ++seq;
        set({
          query, queryKey: key, raw: [], items: [], bundles: [], entries: [], nextCursor: null, hidden: [], loadingMore: false, error: null,
          olderOnServer: false, loadingOlder: false, olderError: null, serverSearch: "idle", status: query ? "loading" : "idle",
        });
        if (!query) return;
        api.listThreads({ ...query, limit: PAGE_SIZE }).then((page) => {
          if (id !== seq) return;
          set({ nextCursor: page.nextCursor, olderOnServer: page.olderOnServer === true, status: "ready" });
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
          set({ nextCursor, olderOnServer: nextCursor === null && olderOnServer, status: "ready", error: null });
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

      hide(ids) {
        apply(get().raw, get().bundles, [...new Set([...get().hidden, ...ids])]);
      },

      unhide(ids) {
        const drop = new Set(ids);
        apply(get().raw, get().bundles, get().hidden.filter((id) => !drop.has(id)));
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
