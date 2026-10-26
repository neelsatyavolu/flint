import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { HomeData, SidebarData } from "@flint/core";
import { flint } from "../../lib/api";
import { createMockApi } from "../../mock";
import { AppContext, type AppData } from "../../state/AppContext";
import { navStore } from "../../state/nav";
import { ToastProvider } from "../../ui";
import { HomeView } from "./HomeView";

const EMPTY_HOME: HomeData = { greetingName: "Alex", unreadPeople: [], pinned: [], awaitingReply: [], recentReceipts: [], snoozedToday: 0, scheduledCount: 0 };

async function mount(edit: (sidebar: SidebarData) => SidebarData = (s) => s) {
  const api = createMockApi({ now: Date.now() });
  const [accounts, sidebar, settings] = await Promise.all([api.listAccounts(), api.getSidebar(), api.getSettings()]);
  const data: AppData = { settings, updateSettings: async () => settings, accounts, refreshAccounts: () => undefined, sidebar: edit(sidebar), narrow: false, selfAddresses: [] };
  render(
    <ToastProvider>
      <AppContext.Provider value={data}><HomeView /></AppContext.Provider>
    </ToastProvider>,
  );
  await act(async () => { await Promise.resolve(); });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  navStore.getState().go({ view: "inbox" });
});

describe("HomeView", () => {
  it("offers a retry when Home can't load", async () => {
    const getHome = vi.spyOn(flint, "getHome").mockRejectedValueOnce(new Error("offline"));
    await mount();
    expect(await screen.findByText("Couldn't load Home")).toBeTruthy();
    getHome.mockResolvedValue(EMPTY_HOME);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: /Alex/ })).toBeTruthy();
    expect(screen.queryByText("Couldn't load Home")).toBeNull();
  });

  it("says it is getting mail during an account's first sync", async () => {
    vi.spyOn(flint, "getHome").mockResolvedValue(EMPTY_HOME);
    vi.spyOn(flint, "listScheduled").mockResolvedValue([]);
    await mount((s) => ({ ...s, accounts: s.accounts.map((a, i) => (i === 0 ? { ...a, sync: { accountId: a.account.id, state: "syncing" } } : a)) }));
    expect(await screen.findByText("Getting your mail…")).toBeTruthy();
  });

  it("opens a view from the glance row", async () => {
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /^Drafts\s*\d+$/ }));
    expect(navStore.getState().view).toBe("drafts");
  });

  it("labels each block by its heading and approves held sends inline", async () => {
    const approve = vi.spyOn(flint, "approveSend");
    await mount();
    const region = await screen.findByRole("region", { name: "Waiting for your OK" });
    fireEvent.click(region.querySelector("button")!);
    expect(approve).toHaveBeenCalledWith(expect.any(Number), true);
  });
});
