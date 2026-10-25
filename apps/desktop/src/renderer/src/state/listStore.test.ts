import { describe, expect, it, vi } from "vitest";
import type { ThreadPage, ThreadQuery } from "@flint/core";
import { createListStore, queryKey } from "./listStore";
import { bundle, item } from "./testFixtures";

const all = Array.from({ length: 120 }, (_, i) => item(i + 1));

function api() {
  const listThreads = vi.fn(async (q: ThreadQuery): Promise<ThreadPage> => {
    const start = q.cursor ? Number(q.cursor) : 0;
    const limit = q.limit ?? 50;
    const items = all.slice(start, start + limit);
    const next = start + limit < all.length ? String(start + limit) : null;
    return { items, bundles: q.focused ? [bundle("newsletters", 0)] : [], nextCursor: next };
  });
  return { listThreads };
}

describe("list store", () => {
  it("loads the first page and paginates", async () => {
    const a = api();
    const s = createListStore(a);
    s.getState().setQuery({ view: "inbox" });
    expect(s.getState().status).toBe("loading");
    await vi.waitFor(() => expect(s.getState().status).toBe("ready"));
    expect(s.getState().items).toHaveLength(50);
    await s.getState().loadMore();
    expect(s.getState().items).toHaveLength(100);
    await s.getState().loadMore();
    await s.getState().loadMore();
    expect(s.getState().items).toHaveLength(120);
    expect(s.getState().nextCursor).toBeNull();
  });

  it("ignores a repeated query and clears on null", async () => {
    const a = api();
    const s = createListStore(a);
    s.getState().setQuery({ view: "inbox" });
    s.getState().setQuery({ view: "inbox", cursor: "x" });
    expect(a.listThreads).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(s.getState().status).toBe("ready"));
    s.getState().setQuery(null);
    expect(s.getState()).toMatchObject({ status: "idle", items: [] });
  });

  it("keeps rows and reuses unchanged objects on refresh", async () => {
    const a = api();
    const s = createListStore(a);
    s.getState().setQuery({ view: "inbox" });
    await vi.waitFor(() => expect(s.getState().status).toBe("ready"));
    await s.getState().loadMore();
    const before = s.getState().items;
    await s.getState().refresh();
    expect(s.getState().items).toHaveLength(100);
    expect(s.getState().items[0]).toBe(before[0]);
  });

  it("hides and unhides rows without losing them", async () => {
    const s = createListStore(api());
    s.getState().setQuery({ view: "inbox" });
    await vi.waitFor(() => expect(s.getState().status).toBe("ready"));
    s.getState().hide([1, 2]);
    expect(s.getState().items[0]?.id).toBe(3);
    expect(s.getState().raw).toHaveLength(50);
    s.getState().unhide([1]);
    expect(s.getState().items[0]?.id).toBe(1);
  });

  it("patches rows with an object or a function", async () => {
    const s = createListStore(api());
    s.getState().setQuery({ view: "inbox" });
    await vi.waitFor(() => expect(s.getState().status).toBe("ready"));
    s.getState().patchItems([1], { pinned: true });
    s.getState().patchItems([2], (i) => ({ subject: `${i.subject}!` }));
    expect(s.getState().items[0]?.pinned).toBe(true);
    expect(s.getState().items[1]?.subject).toBe("Subject 2!");
  });

  it("folds bundles into entries in focused mode", async () => {
    const s = createListStore(api());
    s.getState().setQuery({ view: "inbox", focused: true });
    await vi.waitFor(() => expect(s.getState().status).toBe("ready"));
    expect(s.getState().entries.at(-1)?.key).toBe("b:newsletters");
  });

  it("surfaces errors", async () => {
    const s = createListStore({ listThreads: async () => { throw new Error("boom"); } });
    s.getState().setQuery({ view: "inbox" });
    await vi.waitFor(() => expect(s.getState().status).toBe("error"));
    expect(s.getState().error).toBe("boom");
  });

  it("drops stale responses", async () => {
    let release: (p: ThreadPage) => void = () => undefined;
    const slow = new Promise<ThreadPage>((r) => { release = r; });
    const listThreads = vi.fn().mockReturnValueOnce(slow).mockResolvedValue({ items: [item(9)], bundles: [], nextCursor: null });
    const s = createListStore({ listThreads });
    s.getState().setQuery({ view: "inbox" });
    s.getState().setQuery({ view: "sent" });
    await vi.waitFor(() => expect(s.getState().items[0]?.id).toBe(9));
    release({ items: [item(1)], bundles: [], nextCursor: null });
    await Promise.resolve();
    expect(s.getState().items[0]?.id).toBe(9);
  });

  it("builds a stable key", () => {
    expect(queryKey({ view: "inbox", focused: true, cursor: "9", limit: 5 })).toBe(queryKey({ focused: true, view: "inbox" }));
  });
});
