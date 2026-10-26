import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { HomeData, ScheduledSend, SidebarData, ThreadListItem, ThreadPage } from "@flint/core";
import { FlintError } from "@flint/core/types";
import { flint } from "../../lib/api";
import { createMockApi } from "../../mock";
import { AppContext, type AppData } from "../../state/AppContext";
import { navStore } from "../../state/nav";
import { ToastProvider } from "../../ui";
import { HomeView } from "./HomeView";

const EMPTY_HOME: HomeData = { greetingName: "Alex", unreadPeople: [], pinned: [], awaitingReply: [], recentReceipts: [], snoozedToday: 0, scheduledCount: 0 };
const EMPTY_PAGE: ThreadPage = { items: [], bundles: [], nextCursor: null };

/** Home with nothing anywhere: no home lists, sends, needs-reply rows, drafts or snoozed threads. */
function quiet() {
  vi.spyOn(flint, "getHome").mockResolvedValue(EMPTY_HOME);
  vi.spyOn(flint, "listScheduled").mockResolvedValue([]);
  vi.spyOn(flint, "aiRunToText").mockResolvedValue({ text: "[]" });
  vi.spyOn(flint, "listDrafts").mockResolvedValue([]);
  return vi.spyOn(flint, "listThreads").mockResolvedValue(EMPTY_PAGE);
}

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
    quiet();
    await mount((s) => ({ ...s, accounts: s.accounts.map((a, i) => (i === 0 ? { ...a, sync: { accountId: a.account.id, state: "syncing" } } : a)) }));
    expect(await screen.findByText("Getting your mail…")).toBeTruthy();
  });

  it("opens a view from the glance row", async () => {
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /^Drafts\s*\d+$/ }));
    expect(navStore.getState().view).toBe("drafts");
  });

  it("says nothing needs you only when no block has anything", async () => {
    quiet();
    await mount();
    expect(await screen.findByText("Nothing needs you right now.")).toBeTruthy();
    cleanup();

    const ask = { threadId: 5, subject: "Plan for Thursday", from: { name: "Ana Lima", address: "ana@x.com" }, date: Date.now(), unreadCount: 0, reason: "question" };
    vi.mocked(flint.aiRunToText).mockResolvedValue({ text: JSON.stringify([ask]) });
    await mount();
    expect(await screen.findByRole("region", { name: "Needs reply" })).toBeTruthy();
    expect(screen.queryByText("Nothing needs you right now.")).toBeNull();
  });

  it("finds a snoozed thread due back today past the first page of snoozed mail", async () => {
    const list = quiet();
    const due = { id: 77, subject: "Lease renewal", snoozedUntil: Date.now() } as ThreadListItem;
    list.mockImplementation(async (q) => {
      if (q.view !== "snoozed") return EMPTY_PAGE;
      return q.cursor ? { items: [due], bundles: [], nextCursor: null } : { items: [], bundles: [], nextCursor: "next" };
    });
    await mount();
    const today = await screen.findByRole("region", { name: "Today" });
    expect(today.textContent).toContain("Lease renewal");
    expect(screen.queryByText("Nothing needs you right now.")).toBeNull();
  });

  it("keeps a decided send's buttons off, and treats an already-decided send as no failure", async () => {
    const held = { id: 9, subject: "Invoice", to: [], status: "awaiting_approval", requestedBy: "agent" } as unknown as ScheduledSend;
    quiet();
    const listed = vi.mocked(flint.listScheduled).mockResolvedValue([held]);
    const approve = vi.spyOn(flint, "approveSend").mockResolvedValue({ ...held, status: "pending" });
    await mount();
    const region = await screen.findByRole("region", { name: "Waiting for your OK" });
    const send = () => region.querySelector("button")!;
    await act(async () => { fireEvent.click(send()); });
    expect(approve).toHaveBeenCalledTimes(1);
    expect(send().disabled).toBe(true);
    cleanup();

    approve.mockRejectedValue(new FlintError("conflict", "That send isn't waiting for approval."));
    await mount();
    const again = await screen.findByRole("region", { name: "Waiting for your OK" });
    const before = listed.mock.calls.length;
    await act(async () => { fireEvent.click(again.querySelector("button")!); });
    expect(screen.queryByText("Couldn't send it. Try again.")).toBeNull();
    expect(listed.mock.calls.length).toBeGreaterThan(before);
  });

  it("labels each block by its heading and approves held sends inline", async () => {
    const approve = vi.spyOn(flint, "approveSend");
    await mount();
    const region = await screen.findByRole("region", { name: "Waiting for your OK" });
    fireEvent.click(region.querySelector("button")!);
    expect(approve).toHaveBeenCalledWith(expect.any(Number), true);
  });
});
