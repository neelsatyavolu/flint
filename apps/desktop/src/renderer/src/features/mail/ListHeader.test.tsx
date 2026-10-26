import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ThreadPage } from "@flint/core";
import { flint } from "../../lib/api";
import { createMockApi } from "../../mock";
import { AppContext, type AppData } from "../../state/AppContext";
import { navStore } from "../../state/nav";
import { ToastProvider } from "../../ui";
import { item } from "../../state/testFixtures";
import { ListHeader } from "./ListHeader";

async function mount() {
  const api = createMockApi({ now: Date.now() });
  const [accounts, sidebar, settings] = await Promise.all([api.listAccounts(), api.getSidebar(), api.getSettings()]);
  const data: AppData = { settings, updateSettings: async () => settings, accounts, refreshAccounts: () => undefined, sidebar, narrow: false, selfAddresses: [] };
  render(
    <ToastProvider>
      <AppContext.Provider value={data}><ListHeader /></AppContext.Provider>
    </ToastProvider>,
  );
  await act(async () => { await Promise.resolve(); });
}

const status = (connected: boolean, enabled = true) => ({ connected, enabled, provider: connected ? "codex" : null, model: null, models: [] }) as never;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navStore.getState().go({ view: "inbox" });
});

describe("ListHeader bundle summary", () => {
  it("offers a summary inside a Newsletters bundle when AI is on", async () => {
    vi.spyOn(flint, "aiStatus").mockResolvedValue(status(true));
    navStore.getState().go({ view: "inbox" });
    navStore.getState().openCategory("newsletters");
    await mount();
    expect(await screen.findByRole("button", { name: /summarize newsletters/i })).toBeTruthy();
  });

  it("offers nothing in the plain inbox", async () => {
    vi.spyOn(flint, "aiStatus").mockResolvedValue(status(true));
    await mount();
    expect(screen.queryByRole("button", { name: /summarize/i })).toBeNull();
  });

  it("offers nothing when AI is not connected", async () => {
    vi.spyOn(flint, "aiStatus").mockResolvedValue(status(false));
    navStore.getState().openCategory("notifications");
    await mount();
    expect(screen.queryByRole("button", { name: /summarize/i })).toBeNull();
  });
});

describe("ListHeader filter and selection", () => {
  it("filters the inbox to unread or attachments, and only offers unread inside a bundle", async () => {
    vi.spyOn(flint, "aiStatus").mockResolvedValue(status(false));
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Has attachments/ }));
    expect(navStore.getState().listFilter).toBe("attachments");
    expect(screen.getByRole("button", { name: "Filter: Has attachments" }).getAttribute("aria-pressed")).toBe("true");
    cleanup();
    navStore.getState().openCategory("newsletters");
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect(await screen.findByRole("menuitem", { name: /Unread/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Has attachments/ })).toBeNull();
  });

  it("offers no filter outside inbox and folder views", async () => {
    vi.spyOn(flint, "aiStatus").mockResolvedValue(status(false));
    navStore.getState().go({ view: "sent" });
    await mount();
    expect(screen.queryByRole("button", { name: "Filter" })).toBeNull();
    expect(screen.getByRole("button", { name: "Select all" })).toBeTruthy();
  });
});

describe("ListHeader bundle triage", () => {
  const page = (n: number): ThreadPage => ({ items: Array.from({ length: n }, (_, i) => item(i + 1)), bundles: [], nextCursor: null });

  it("archives a small bundle at once", async () => {
    vi.spyOn(flint, "aiStatus").mockResolvedValue(status(false));
    const list = vi.spyOn(flint, "listThreads").mockResolvedValue(page(3));
    const archive = vi.spyOn(flint, "archive").mockResolvedValue({ undoToken: "u1" });
    navStore.getState().openCategory("notifications");
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "More for Notifications" }));
    await act(async () => { fireEvent.click(await screen.findByRole("menuitem", { name: "Archive all" })); });
    expect(list).toHaveBeenCalledWith({ view: "inbox", category: "notifications", accountId: undefined, limit: 200 });
    expect(archive).toHaveBeenCalledWith([1, 2, 3]);
  });

  it("asks before marking more than 50 as read", async () => {
    vi.spyOn(flint, "aiStatus").mockResolvedValue(status(false));
    vi.spyOn(flint, "listThreads").mockResolvedValue(page(60));
    const markRead = vi.spyOn(flint, "markRead").mockResolvedValue({ undoToken: "u2" });
    navStore.getState().openCategory("newsletters");
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "More for Newsletters" }));
    await act(async () => { fireEvent.click(await screen.findByRole("menuitem", { name: "Mark all as read" })); });
    expect(markRead).not.toHaveBeenCalled();
    expect(screen.getByText(/60 unread conversations will be marked as read/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Mark as read 60" })); });
    expect(markRead).toHaveBeenCalledWith(expect.arrayContaining([1, 60]), true);
  });
});
