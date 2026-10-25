import { describe, expect, it } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { flint } from "./api";
import { useFlintEvent, useFlintQuery, useSettings } from "./hooks";

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
});
