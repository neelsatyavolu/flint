import { describe, expect, it, vi } from "vitest";
import type { ThreadPage, ThreadQuery } from "@flint/core";
import { createListStore, SERVER_SEARCH_REPEAT_MS } from "./listStore";
import { item } from "./testFixtures";

/** A server with `local` rows on this computer and `server` older rows, `batch` of which come down per loadOlder. */
function rig(local: number, server: number, batch: number) {
  let have = local;
  let left = server;
  const listThreads = vi.fn(async (q: ThreadQuery): Promise<ThreadPage> => {
    const start = q.cursor ? Number(q.cursor) : 0;
    const limit = q.limit ?? 50;
    const items = Array.from({ length: Math.min(limit, have - start) }, (_, i) => item(start + i + 1));
    const next = start + limit < have ? String(start + limit) : null;
    return { items, bundles: [], nextCursor: next, ...(next === null ? { olderOnServer: left > 0 } : {}) };
  });
  const loadOlder = vi.fn(async () => {
    const n = Math.min(batch, left);
    left -= n;
    have += n;
    return { loaded: n, hasMore: left > 0 };
  });
  const searchServer = vi.fn(async () => { have += 3; return { found: 3, added: 3 }; });
  return { listThreads, loadOlder, searchServer };
}

describe("list store history", () => {
  it("knows the server has older mail once the local list ends", async () => {
    const s = createListStore(rig(10, 100, 40));
    s.getState().setQuery({ view: "inbox" });
    await vi.waitFor(() => expect(s.getState().status).toBe("ready"));
    expect(s.getState().olderOnServer).toBe(true);
  });

  it("loadOlder pulls a batch, shows it and keeps the flag while more is on the server", async () => {
    const api = rig(10, 100, 60);
    const s = createListStore(api);
    s.getState().setQuery({ view: "inbox" });
    await vi.waitFor(() => expect(s.getState().status).toBe("ready"));
    await s.getState().loadOlder();
    expect(api.loadOlder).toHaveBeenCalledTimes(1);
    expect(s.getState().items).toHaveLength(70);
    expect(s.getState().olderOnServer).toBe(true);
    expect(s.getState().loadingOlder).toBe(false);
    await s.getState().loadOlder();
    expect(s.getState().items).toHaveLength(110);
    expect(s.getState().olderOnServer).toBe(false);
  });

  it("does not run two loadOlder at once and reports a failure", async () => {
    const api = rig(10, 100, 20);
    let release: () => void = () => undefined;
    api.loadOlder.mockImplementationOnce(() => new Promise((r) => { release = () => r({ loaded: 0, hasMore: true }); }));
    const s = createListStore(api);
    s.getState().setQuery({ view: "inbox" });
    await vi.waitFor(() => expect(s.getState().status).toBe("ready"));
    const first = s.getState().loadOlder();
    await s.getState().loadOlder();
    expect(api.loadOlder).toHaveBeenCalledTimes(1);
    expect(s.getState().loadingOlder).toBe(true);
    release();
    await first;
    api.loadOlder.mockRejectedValueOnce(new Error("Couldn't reach imap.example.com."));
    await s.getState().loadOlder();
    expect(s.getState().olderError).toBe("Couldn't reach imap.example.com.");
    expect(s.getState().loadingOlder).toBe(false);
  });

  it("searches the server once per search query and merges the results", async () => {
    const api = rig(2, 0, 0);
    const s = createListStore(api);
    s.getState().setQuery({ view: "search", search: "rollup" });
    await vi.waitFor(() => expect(s.getState().status).toBe("ready"));
    await s.getState().searchServer();
    expect(api.searchServer).toHaveBeenCalledWith("rollup", undefined);
    expect(s.getState().serverSearch).toBe("done");
    expect(s.getState().items).toHaveLength(5);
    await s.getState().searchServer();
    expect(api.searchServer).toHaveBeenCalledTimes(1);
  });

  it("asks the server again after a while by itself, and at once on an explicit click", async () => {
    const api = rig(2, 0, 0);
    let t = 1_000_000;
    const s = createListStore(api, () => t);
    s.getState().setQuery({ view: "search", search: "rollup" });
    await vi.waitFor(() => expect(s.getState().status).toBe("ready"));
    await s.getState().searchServer();
    await s.getState().searchServer({ explicit: true });
    expect(api.searchServer).toHaveBeenCalledTimes(2);
    s.getState().setQuery({ view: "search", search: "other" });
    s.getState().setQuery({ view: "search", search: "rollup" });
    await vi.waitFor(() => expect(s.getState().status).toBe("ready"));
    await s.getState().searchServer();
    expect(api.searchServer).toHaveBeenCalledTimes(2);
    t += SERVER_SEARCH_REPEAT_MS;
    await s.getState().searchServer();
    expect(api.searchServer).toHaveBeenCalledTimes(3);
  });

  it("never searches the server outside search, and a failure is reported quietly", async () => {
    const api = rig(2, 0, 0);
    const s = createListStore(api);
    s.getState().setQuery({ view: "inbox" });
    await vi.waitFor(() => expect(s.getState().status).toBe("ready"));
    await s.getState().searchServer();
    expect(api.searchServer).not.toHaveBeenCalled();
    api.searchServer.mockRejectedValueOnce(new Error("offline"));
    s.getState().setQuery({ view: "search", search: "x1" });
    await vi.waitFor(() => expect(s.getState().status).toBe("ready"));
    await s.getState().searchServer();
    expect(s.getState().serverSearch).toBe("error");
  });
});
