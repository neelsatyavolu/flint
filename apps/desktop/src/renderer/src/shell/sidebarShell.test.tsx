import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { SidebarData } from "@flint/core";
import { flint } from "../lib/api";
import { createMockApi } from "../mock";
import { AppContext, type AppData } from "../state/AppContext";
import { listStore } from "../state/listStore";
import { navStore } from "../state/nav";
import { moreFolders } from "../state/sidebarModel";
import { item } from "../state/testFixtures";
import { ToastProvider } from "../ui";
import { AuthBanner } from "./AuthBanner";
import { NavItem, navAriaLabel, parseDraggedThreads, THREADS_MIME } from "./NavItem";
import { Sidebar } from "./Sidebar";

const NOW = Date.UTC(2026, 9, 25, 15);

async function appData(expire: (accountIndex: number) => boolean = () => false): Promise<AppData> {
  const api = createMockApi({ now: NOW });
  const [accounts, base, settings] = await Promise.all([api.listAccounts(), api.getSidebar(), api.getSettings()]);
  const sidebar: SidebarData = {
    ...base,
    accounts: base.accounts.map((a, i) => (expire(i) ? { ...a, sync: { accountId: a.account.id, state: "auth_error" as const } } : a)),
  };
  return { settings, updateSettings: async () => settings, accounts, refreshAccounts: vi.fn(), sidebar, narrow: false, selfAddresses: [] };
}

function mount(data: AppData, ui: React.ReactNode) {
  return render(
    <ToastProvider>
      <AppContext.Provider value={data}>{ui}</AppContext.Provider>
    </ToastProvider>,
  );
}

const dragData = (payload: string) => ({ types: [THREADS_MIME], getData: (t: string) => (t === THREADS_MIME ? payload : ""), dropEffect: "none" });

describe("NavItem", () => {
  it("names the count for screen readers in full and rail mode", () => {
    expect(navAriaLabel("Inbox", 3)).toBe("Inbox, 3 unread");
    expect(navAriaLabel("Drafts", 2, "")).toBe("Drafts, 2");
    expect(navAriaLabel("Sent", 0)).toBe("Sent");
    const { rerender } = render(<NavItem label="Inbox" count={4} onClick={() => undefined} />);
    expect(screen.getByRole("button", { name: "Inbox, 4 unread" })).toBeTruthy();
    rerender(<NavItem label="Inbox" count={4} rail onClick={() => undefined} />);
    expect(screen.getByRole("button", { name: "Inbox, 4 unread" })).toBeTruthy();
  });

  it("reads only JSON arrays of thread ids from a drag", () => {
    expect(parseDraggedThreads("[1, 2, 3]")).toEqual([1, 2, 3]);
    expect(parseDraggedThreads('[1, "2", -4, 2.5]')).toEqual([1]);
    expect(parseDraggedThreads("{}")).toEqual([]);
    expect(parseDraggedThreads("not json")).toEqual([]);
  });

  it("highlights while conversations hover and hands their ids over on drop", () => {
    const onDrop = vi.fn();
    const { container } = render(<NavItem label="Receipts" onClick={() => undefined} onDropThreads={onDrop} />);
    const row = container.firstElementChild!;
    fireEvent.dragOver(row, { dataTransfer: dragData("") });
    expect(row.className).toMatch(/dropOver/);
    fireEvent.drop(row, { dataTransfer: dragData("[7, 9]") });
    expect(row.className).not.toMatch(/dropOver/);
    expect(onDrop).toHaveBeenCalledWith([7, 9]);
  });

  it("ignores drags that are not conversations", () => {
    const onDrop = vi.fn();
    const { container } = render(<NavItem label="Archive" onClick={() => undefined} onDropThreads={onDrop} />);
    const row = container.firstElementChild!;
    fireEvent.dragOver(row, { dataTransfer: { types: ["Files"], getData: () => "" } });
    expect(row.className).not.toMatch(/dropOver/);
  });
});

describe("Sidebar drop targets", () => {
  it("archives conversations dropped on Archive", async () => {
    const archive = vi.spyOn(flint, "archive").mockResolvedValue({ undoToken: "u1" });
    mount(await appData(), <Sidebar rail={false} />);
    const row = screen.getByRole("button", { name: "Archive" }).parentElement!;
    await act(async () => { fireEvent.drop(row, { dataTransfer: dragData("[11]") }); });
    expect(archive).toHaveBeenCalledWith([11]);
    archive.mockRestore();
  });

  it("moves into a folder only conversations from that folder's account", async () => {
    const moveToFolder = vi.spyOn(flint, "moveToFolder").mockResolvedValue({ undoToken: "u2" });
    const data = await appData();
    const owner = data.sidebar!.accounts.find((a) => moreFolders(a.folders).length > 0)!;
    const folder = moreFolders(owner.folders)[0]!;
    const other = data.accounts.find((a) => a.id !== owner.account.id)!;
    listStore.setState({ raw: [item(11, { accountId: owner.account.id }), item(12, { accountId: other.id })] });
    if (!navStore.getState().expanded.more) navStore.getState().toggleExpanded("more");
    mount(data, <Sidebar rail={false} />);
    const row = screen.getAllByRole("button", { name: new RegExp(`^${folder.name}`) })[0]!.parentElement!;
    await act(async () => { fireEvent.drop(row, { dataTransfer: dragData("[11, 12]") }); });
    expect(moveToFolder).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("only move to folders in their own account");
    await act(async () => { fireEvent.drop(row, { dataTransfer: dragData("[11]") }); });
    expect(moveToFolder).toHaveBeenCalledWith([11], folder.id);
    moveToFolder.mockRestore();
  });
});

describe("Auth recovery", () => {
  it("shows a banner per expired account and opens the password sign-in dialog in Settings", async () => {
    const data = await appData((i) => i === 1);
    const orbit = data.accounts[1]!;
    expect(orbit.authKind).toBe("password");
    mount(data, <AuthBanner />);
    expect(screen.getByText(`${orbit.email} needs you to sign in again`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `Sign in to ${orbit.email}` }));
    expect(navStore.getState().settingsOpen).toBe(true);
    expect(navStore.getState().settingsSection).toBe(`accounts/${orbit.id}/reauth`);
    navStore.getState().closeSettings();
  });

  it("starts Google sign-in directly for Google accounts", async () => {
    const data = await appData((i) => i === 0);
    const google = vi.spyOn(flint, "addGoogleAccount").mockResolvedValue(data.accounts[0]!);
    mount(data, <AuthBanner />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: `Sign in to ${data.accounts[0]!.email}` })); });
    expect(google).toHaveBeenCalledOnce();
    expect(data.refreshAccounts).toHaveBeenCalled();
    expect(navStore.getState().settingsOpen).toBe(false);
    google.mockRestore();
  });

  it("renders nothing when every account is signed in", async () => {
    const { container } = mount(await appData(), <AuthBanner />);
    expect(container.textContent).toBe("");
  });
});
