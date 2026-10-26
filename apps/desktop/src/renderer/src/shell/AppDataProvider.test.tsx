import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { flint } from "../lib/api";
import { useApp, useAppCore, useSidebar } from "../state/AppContext";
import { AppDataProvider } from "./AppDataProvider";

afterEach(() => vi.restoreAllMocks());

function Probe() {
  const { accounts, selfAddresses, sidebar } = useApp();
  return <p>{`accounts:${accounts.length} self:${selfAddresses.length > 0} sidebar:${sidebar ? "yes" : "no"}`}</p>;
}

describe("AppDataProvider", () => {
  it("shares settings, accounts and the sidebar once they load", async () => {
    render(<AppDataProvider><Probe /></AppDataProvider>);
    await screen.findByText(/accounts:\d+ self:true sidebar:yes/);
  });

  it("shows the boot error instead of a blank window and recovers on Try again", async () => {
    vi.spyOn(flint, "getSettings").mockRejectedValueOnce(new Error("The database is locked."));
    const accounts = vi.spyOn(flint, "listAccounts").mockRejectedValueOnce(new Error("The database is locked."));
    render(<AppDataProvider><Probe /></AppDataProvider>);
    await screen.findByText("Flint couldn't load your mail data");
    expect(screen.getByText("The database is locked.")).toBeTruthy();
    await act(async () => { screen.getByRole("button", { name: "Try again" }).click(); });
    await screen.findByText(/accounts:\d+/);
    expect(accounts.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps sidebar updates away from components that only read the core", async () => {
    let coreRenders = 0;
    function CoreReader() {
      const renders = useRef(0);
      renders.current++;
      coreRenders = renders.current;
      useAppCore();
      return null;
    }
    function SidebarReader() {
      const sidebar = useSidebar();
      return <p>{sidebar ? `inbox:${sidebar.counts.inbox}` : "no sidebar"}</p>;
    }
    const base = await flint.getSidebar();
    let inbox = base.counts.inbox;
    vi.spyOn(flint, "getSidebar").mockImplementation(async () => ({ ...base, counts: { ...base.counts, inbox } }));
    const listeners: Array<(e: Parameters<Parameters<typeof flint.subscribe>[0]>[0]) => void> = [];
    const subscribe = flint.subscribe.bind(flint);
    vi.spyOn(flint, "subscribe").mockImplementation((l) => { listeners.push(l); return subscribe(l); });
    render(<AppDataProvider><CoreReader /><SidebarReader /></AppDataProvider>);
    await screen.findByText(`inbox:${inbox}`);
    const before = coreRenders;
    inbox += 5;
    act(() => listeners.forEach((l) => l({ type: "sync", status: {} } as never)));
    await screen.findByText(`inbox:${inbox}`);
    expect(coreRenders).toBe(before);
  });
});
