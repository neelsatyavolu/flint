import { describe, expect, it, vi } from "vitest";
import type { FlintEvent } from "@flint/core";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { flint } from "./api";
import { REFETCH_DEBOUNCE_MS, REFETCH_MAX_WAIT_MS, useFlintEvent, useFlintQuery, useSettings } from "./hooks";

describe("lazy api in a browser", () => {
  it("falls back to the mock when window.flint is absent", async () => {
    const accounts = await flint.listAccounts();
    expect(accounts.map((a) => a.email)).toContain("alex@northwind.dev");
  });
});

describe("useFlintQuery", () => {
  it("loads data and refetches when mail changes", async () => {
    const { result } = renderHook(() => useFlintQuery((api) => api.getSidebar(), []));
    await waitFor(() => expect(result.current.data).toBeDefined());
    const before = result.current.data!.counts.pinned;
    const threads = await flint.listThreads({ view: "inbox", limit: 50 });
    const unpinned = threads.items.find((t) => !t.pinned)!;
    await act(async () => {
      await flint.setPinned([unpinned.id], true);
    });
    await waitFor(() => expect(result.current.data!.counts.pinned).not.toBe(before));
  });

  it("keeps the previous data while reloading and surfaces errors", async () => {
    const { result } = renderHook(() => useFlintQuery((api) => api.getThread(999999), []));
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.error!.message).toMatch(/no longer exists/);
    expect(result.current.loading).toBe(false);
  });

  it("coalesces bursts of events, filters by thread and skips unchanged data", async () => {
    const listeners: Array<(e: FlintEvent) => void> = [];
    vi.spyOn(flint, "subscribe").mockImplementation((l) => { listeners.push(l); return () => undefined; });
    let calls = 0;
    const same = { n: 1 };
    const { result } = renderHook(() => useFlintQuery(async () => { calls++; return { ...same }; }, [], { threadId: 7 }));
    await waitFor(() => expect(result.current.data).toBeDefined());
    const first = result.current.data;
    const emit = (threadIds: number[]) => act(() => listeners.forEach((l) => l({ type: "mail_changed", accountId: "a1", threadIds })));
    emit([9]);
    await new Promise((r) => setTimeout(r, REFETCH_DEBOUNCE_MS + 60));
    expect(calls).toBe(1);
    emit([7]); emit([7]); emit([7, 8]);
    await new Promise((r) => setTimeout(r, REFETCH_DEBOUNCE_MS + 60));
    expect(calls).toBe(2);
    expect(result.current.data).toBe(first);
    vi.restoreAllMocks();
  });

  it("starts over when the deps change, so a new query never shows the last one's error or data", async () => {
    const { result, rerender } = renderHook(({ id }) => useFlintQuery(async () => {
      if (id === 1) throw new Error("gone");
      await new Promise((r) => setTimeout(r, 30));
      return id;
    }, [id]), { initialProps: { id: 1 } });
    await waitFor(() => expect(result.current.error?.message).toBe("gone"));
    rerender({ id: 2 });
    expect(result.current.error).toBeUndefined();
    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toBe(2));
    rerender({ id: 3 });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toBe(3));
  });

  it("refetches during a steady stream of events instead of waiting for it to stop", async () => {
    const listeners: Array<(e: FlintEvent) => void> = [];
    vi.spyOn(flint, "subscribe").mockImplementation((l) => { listeners.push(l); return () => undefined; });
    let calls = 0;
    const { result } = renderHook(() => useFlintQuery(async () => ++calls, []));
    await waitFor(() => expect(result.current.data).toBe(1));
    const started = Date.now();
    while (Date.now() - started < REFETCH_MAX_WAIT_MS + 300) {
      act(() => listeners.forEach((l) => l({ type: "mail_changed", accountId: "a1", threadIds: [] })));
      await new Promise((r) => setTimeout(r, REFETCH_DEBOUNCE_MS / 3));
    }
    expect(calls).toBeGreaterThanOrEqual(2);
    vi.restoreAllMocks();
  });

  it("does not fetch when disabled", async () => {
    let calls = 0;
    renderHook(() => useFlintQuery(async () => { calls++; return 1; }, [], { enabled: false }));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(0);
  });
});

describe("useFlintEvent and useSettings", () => {
  it("delivers typed events", async () => {
    const seen: string[] = [];
    function Probe() {
      useFlintEvent("settings", (e) => seen.push(e.settings.appearance.density));
      return null;
    }
    render(<Probe />);
    await flint.listAccounts(); // ensure the lazy mock is loaded and subscribed
    await new Promise((r) => setTimeout(r, 10));
    await flint.updateSettings({ appearance: { density: "compact" } });
    await waitFor(() => expect(seen).toContain("compact"));
    await flint.updateSettings({ appearance: { density: "comfortable" } });
  });

  it("useSettings updates through the api", async () => {
    function View() {
      const { settings, update } = useSettings();
      return <button onClick={() => void update({ inbox: { focused: false } })}>{settings ? `focused:${settings.inbox.focused}` : "loading"}</button>;
    }
    render(<View />);
    await screen.findByText("focused:true");
    await act(async () => { screen.getByRole("button").click(); });
    await screen.findByText("focused:false");
    await flint.updateSettings({ inbox: { focused: true } });
  });

  it("useSettings reports a failed first load and tries again on reload", async () => {
    const get = vi.spyOn(flint, "getSettings").mockRejectedValueOnce(new Error("database locked"));
    function View() {
      const { settings, error, reload } = useSettings();
      return <button onClick={reload}>{settings ? "ready" : error ? `error:${error.message}` : "loading"}</button>;
    }
    render(<View />);
    await screen.findByText("error:database locked");
    await act(async () => { screen.getByRole("button").click(); });
    await screen.findByText("ready");
    expect(get).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
});
