import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SidebarAccount, ThreadListItem } from "@flint/core";
import { createMockApi } from "../../mock";
import { AppContext, type AppData } from "../../state/AppContext";
import { buildEntries } from "../../state/grouping";
import { listStore } from "../../state/listStore";
import { navStore } from "../../state/nav";
import { item } from "../../state/testFixtures";
import { detectMac } from "../../lib/shortcuts";
import { flint } from "../../lib/api";
import { setSingleKeyShortcuts } from "../../shell/useGlobalShortcuts";
import { ToastProvider } from "../../ui";
import { THREADS_MIME, ThreadList, firstSyncProgress } from "./ThreadList";

const NOW = Date.UTC(2026, 9, 25, 15);
const rows = [item(1, { unreadCount: 1 }), item(2), item(3)];

async function mount(list: ThreadListItem[] = rows, patch: Partial<AppData> = {}) {
  const api = createMockApi({ now: NOW });
  const [accounts, sidebar, settings] = await Promise.all([api.listAccounts(), api.getSidebar(), api.getSettings()]);
  const data: AppData = { settings, updateSettings: async () => settings, accounts, refreshAccounts: () => undefined, sidebar, narrow: false, selfAddresses: [], ...patch };
  listStore.setState({ raw: list, items: list, hidden: [], entries: buildEntries(list, []), status: "ready", stale: false, nextCursor: null, error: null, pageError: null, olderOnServer: false, serverSearch: "idle", queryKey: "test" });
  render(
    <ToastProvider>
      <AppContext.Provider value={data}><ThreadList /></AppContext.Provider>
    </ToastProvider>,
  );
  return data;
}

const listbox = () => screen.getByRole("listbox", { name: "Conversations" });
const mod = detectMac() ? { metaKey: true } : { ctrlKey: true };

beforeEach(() => {
  // jsdom has no layout, so the virtualized list would render no rows.
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 900 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 380 });
  navStore.getState().go({ view: "inbox" });
});
afterEach(() => cleanup());

describe("ThreadList keyboard and screen-reader access", () => {
  it("is focusable, puts the cursor on the first row and names it as the active option", async () => {
    await mount();
    expect(listbox().tabIndex).toBe(0);
    expect(listbox().getAttribute("aria-activedescendant")).toBeNull();
    act(() => listbox().focus());
    expect(navStore.getState().cursorKey).toBe("t1");
    expect(listbox().getAttribute("aria-activedescendant")).toBe("row-t1");
    expect(document.getElementById("row-t1")?.getAttribute("role")).toBe("option");
  });

  it("selects every row with mod+A", async () => {
    await mount();
    fireEvent.keyDown(listbox(), { key: "a", ...mod });
    expect(navStore.getState().selected).toEqual([1, 2, 3]);
  });

  it("toggles the unread filter with shift+U", async () => {
    await mount();
    fireEvent.keyDown(listbox(), { key: "U", shiftKey: true });
    expect(navStore.getState().listFilter).toBe("unread");
    fireEvent.keyDown(listbox(), { key: "U", shiftKey: true });
    expect(navStore.getState().listFilter).toBe("all");
  });

  it("leaves shift+U alone when single-key shortcuts are off", async () => {
    setSingleKeyShortcuts(false);
    try {
      await mount();
      fireEvent.keyDown(listbox(), { key: "U", shiftKey: true });
      expect(navStore.getState().listFilter).toBe("all");
    } finally {
      setSingleKeyShortcuts(true);
    }
  });

  it("blocks the sender from the row menu without archiving the row", async () => {
    const block = vi.spyOn(flint, "blockSender").mockResolvedValue(undefined);
    const archive = vi.spyOn(flint, "archive");
    const sender = { name: "Spammy", address: "spam@x.test" };
    await mount([item(1, { participants: [{ name: "me", address: "me@x.test" }, sender] })]);
    fireEvent.contextMenu(document.getElementById("row-t1")!);
    await act(async () => { fireEvent.click(await screen.findByRole("menuitem", { name: /Block sender/ })); });
    expect(block).toHaveBeenCalledWith("spam@x.test");
    expect(archive).not.toHaveBeenCalled();
    expect(await screen.findByText("Blocked spam@x.test. Their mail goes to Blocked")).toBeTruthy();
    vi.restoreAllMocks();
  });

  it("opens the row menu at the cursor row with shift+F10", async () => {
    await mount();
    navStore.getState().setCursor("t2");
    fireEvent.keyDown(listbox(), { key: "F10", shiftKey: true });
    expect(await screen.findByRole("menuitem", { name: /Reply all/ })).toBeTruthy();
  });

  it("keeps date labels out of the option list", async () => {
    await mount();
    for (const label of document.querySelectorAll(".t-label")) expect(label.getAttribute("role")).toBe("presentation");
  });
});

describe("ThreadList states", () => {
  it("says the filter is why the list is empty, and offers the way back", async () => {
    navStore.getState().setListFilter("unread");
    await mount([]);
    expect(screen.getByText("No unread mail here.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(navStore.getState().listFilter).toBe("all");
  });

  it("shows first-sync progress instead of Inbox zero", async () => {
    const api = createMockApi({ now: NOW });
    const sidebar = await api.getSidebar();
    const first = sidebar.accounts[0]!;
    const syncing: SidebarAccount = { ...first, sync: { accountId: first.account.id, state: "syncing", progress: { done: 120, total: 480 } } };
    await mount([], { sidebar: { ...sidebar, accounts: [syncing] } });
    expect(screen.getByText("Getting your mail…")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("25");
  });

  it("drags the selection, or just the row, as thread ids", async () => {
    await mount();
    const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(document.getElementById("row-t2")!, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith(THREADS_MIME, "[2]");
    act(() => navStore.getState().setSelected([1, 3]));
    fireEvent.dragStart(document.getElementById("row-t3")!, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenLastCalledWith(THREADS_MIME, "[1,3]");
    expect(dataTransfer.setDragImage).toHaveBeenCalled();
  });
});

describe("firstSyncProgress", () => {
  const acct = (id: string, sync: Partial<SidebarAccount["sync"]>) => ({ account: { id }, sync: { accountId: id, state: "idle", ...sync } }) as unknown as SidebarAccount;
  it("sums accounts in scope that never finished a sync", () => {
    const list = [acct("a", { state: "syncing", progress: { done: 1, total: 10 } }), acct("b", { state: "syncing", progress: { done: 2, total: 20 } }), acct("c", { state: "syncing", lastSyncAt: 5 })];
    expect(firstSyncProgress(list, undefined)).toEqual({ done: 3, total: 30 });
    expect(firstSyncProgress(list, "b")).toEqual({ done: 2, total: 20 });
    expect(firstSyncProgress(list, "c")).toBeNull();
    expect(firstSyncProgress([acct("d", {})], undefined)).toBeNull();
  });
});
