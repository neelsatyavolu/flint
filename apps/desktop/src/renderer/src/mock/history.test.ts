import { describe, expect, it } from "vitest";
import { createMockApi } from "./api";

const NOW = new Date(2026, 9, 25, 16, 0).getTime();

describe("mock older mail", () => {
  it("the inbox reports older mail on its last page and loadOlder hands it out in batches", async () => {
    const api = createMockApi({ now: NOW });
    const all = await api.listThreads({ view: "inbox", limit: 200 });
    expect(all.nextCursor).toBeNull();
    expect(all.olderOnServer).toBe(true);
    let loaded = 0;
    for (let i = 0; i < 6; i++) {
      const r = await api.loadOlder({ view: "inbox" });
      loaded += r.loaded;
      if (!r.hasMore) break;
    }
    expect(loaded).toBeGreaterThan(50);
    const after = await api.listThreads({ view: "inbox", limit: 200 });
    expect(after.items.length).toBeGreaterThanOrEqual(all.items.length + loaded - 5);
    expect(after.olderOnServer).toBe(false);
  });

  it("server search brings an old message into local search", async () => {
    const api = createMockApi({ now: NOW });
    expect((await api.listThreads({ view: "search", search: "rollup" })).items).toHaveLength(0);
    expect(await api.searchServer("rollup")).toEqual({ found: 1, added: 1 });
    expect((await api.listThreads({ view: "search", search: "rollup" })).items.map((t) => t.subject)).toEqual(["Quarterly budget rollup"]);
    expect(await api.searchServer("rollup")).toEqual({ found: 0, added: 0 });
  });
});
