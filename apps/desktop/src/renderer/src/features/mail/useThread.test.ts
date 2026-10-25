import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ThreadDetail } from "@flint/core";

const getThread = vi.fn();
const handlers: Array<(e: { type: string; threadIds: number[] }) => void> = [];
vi.mock("../../lib/api", () => ({
  flint: {
    getThread: (id: number) => getThread(id),
    subscribe: vi.fn((h: (e: { type: string; threadIds: number[] }) => void) => {
      handlers.push(h);
      return () => {};
    }),
  },
}));

const detail = (id: number): ThreadDetail => ({ id, accountId: "a", subject: `S${id}`, category: "people", pinned: false, muted: false, snoozedUntil: null, messages: [], draftIds: [] });

beforeEach(() => {
  vi.resetModules();
  getThread.mockReset();
  handlers.length = 0;
});

describe("invalidated loads", () => {
  it("does not cache a result that was requested before mail changed, nor drop the newer request", async () => {
    let resolveOld: (t: ThreadDetail) => void = () => undefined;
    let resolveNew: (t: ThreadDetail) => void = () => undefined;
    getThread
      .mockReturnValueOnce(new Promise<ThreadDetail>((r) => (resolveOld = r)))
      .mockReturnValueOnce(new Promise<ThreadDetail>((r) => (resolveNew = r)));
    const { loadThread, peekThread } = await import("./useThread");
    const a = loadThread(11);
    handlers[0]!({ type: "mail_changed", threadIds: [11] });
    const b = loadThread(11);
    expect(getThread).toHaveBeenCalledTimes(2);
    resolveNew({ ...detail(11), subject: "new" });
    await b;
    resolveOld({ ...detail(11), subject: "old" });
    await a;
    expect(peekThread(11)?.subject).toBe("new");
    // The newer request finished first, so a third caller starts a fresh load rather than sharing a stale entry.
    getThread.mockResolvedValue(detail(11));
    await loadThread(11);
  });

  it("keeps sharing the newer request when the older one settles first", async () => {
    let resolveOld: (t: ThreadDetail) => void = () => undefined;
    getThread.mockReturnValueOnce(new Promise<ThreadDetail>((r) => (resolveOld = r))).mockReturnValueOnce(new Promise(() => undefined));
    const { loadThread } = await import("./useThread");
    const a = loadThread(12);
    handlers[0]!({ type: "mail_changed", threadIds: [12] });
    void loadThread(12);
    resolveOld(detail(12));
    await a;
    void loadThread(12);
    expect(getThread).toHaveBeenCalledTimes(2);
  });
});

describe("thread prefetch", () => {
  it("shares one request between a prefetch and the open", async () => {
    getThread.mockResolvedValue(detail(5));
    const { prefetchThread, loadThread, peekThread } = await import("./useThread");
    prefetchThread(5);
    await loadThread(5);
    expect(getThread).toHaveBeenCalledTimes(1);
    expect(peekThread(5)?.subject).toBe("S5");
  });

  it("does not prefetch what is cached", async () => {
    getThread.mockResolvedValue(detail(6));
    const { prefetchThread, loadThread } = await import("./useThread");
    await loadThread(6);
    prefetchThread(6);
    expect(getThread).toHaveBeenCalledTimes(1);
  });

  it("paints a prefetched thread on the first render", async () => {
    getThread.mockResolvedValue(detail(7));
    const { loadThread, useThread } = await import("./useThread");
    await loadThread(7);
    const { result } = renderHook(() => useThread(7));
    expect(result.current.thread?.id).toBe(7);
    await waitFor(() => expect(getThread).toHaveBeenCalledTimes(2));
  });

  it("never returns another thread's data", async () => {
    getThread.mockResolvedValue(detail(8));
    const { useThread } = await import("./useThread");
    const { result, rerender } = renderHook(({ id }) => useThread(id), { initialProps: { id: 8 as number | null } });
    await waitFor(() => expect(result.current.thread?.id).toBe(8));
    getThread.mockReturnValue(new Promise(() => undefined));
    act(() => rerender({ id: 9 }));
    expect(result.current.thread).toBeUndefined();
  });
});
