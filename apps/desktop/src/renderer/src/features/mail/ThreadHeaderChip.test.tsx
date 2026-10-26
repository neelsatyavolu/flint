import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ThreadDetail } from "@flint/core";
import { ToastProvider } from "../../ui";
import { navStore } from "../../state/nav";
import { AppContext, type AppData } from "../../state/AppContext";
import { defaultSettings } from "../../mock/fixtures";
import { ThreadHeader } from "./Reader";
import { flint } from "../../lib/api";

const run = vi.fn();
vi.mock("../../state/useActions", () => ({ useThreadActions: () => ({ run }) }));
vi.mock("../../lib/api", () => ({ flint: { subscribe: vi.fn(() => () => {}), unsubscribe: vi.fn(), listThreads: vi.fn() } }));

const app = { settings: defaultSettings(), updateSettings: async () => defaultSettings(), accounts: [], refreshAccounts: () => undefined, sidebar: undefined, narrow: false, selfAddresses: [] } as unknown as AppData;
const thread = (category: ThreadDetail["category"]): ThreadDetail => ({ id: 9, accountId: "a1", subject: "Concierge request", category, pinned: false, muted: false, snoozedUntil: null, messages: [], draftIds: [] }) as unknown as ThreadDetail;
const show = (t: ThreadDetail) => render(<ToastProvider><AppContext.Provider value={app}><ThreadHeader thread={t} /></AppContext.Provider></ToastProvider>);

describe("category chip in the thread header", () => {
  it("opens the move-to menu and files the thread under the chosen category", () => {
    navStore.setState({ view: "inbox" });
    run.mockClear();
    show(thread("notifications"));
    fireEvent.click(screen.getByRole("button", { name: /Category: Notifications/ }));
    expect(screen.queryByRole("menuitem", { name: "Move to Notifications" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to People" }));
    expect(run).toHaveBeenCalledWith({ type: "category", category: "people" }, [9]);
  });

  it("is a plain label outside the inbox views, where recategorizing is not offered", () => {
    navStore.setState({ view: "trash" });
    show(thread("notifications"));
    expect(screen.queryByRole("button", { name: /Category/ })).toBeNull();
    expect(screen.getByText("Notifications")).toBeTruthy();
  });

  it("shows no chip for People", () => {
    navStore.setState({ view: "inbox" });
    show(thread("people"));
    expect(screen.queryByText("People")).toBeNull();
  });
});

describe("unsubscribe in the thread header", () => {
  const newsletter = {
    ...thread("newsletters"),
    messages: [{ id: 41, from: [{ name: "Weekly", address: "news@weekly.test" }], unsubscribe: { mailto: "mailto:leave@weekly.test", oneClick: false } }],
  } as unknown as ThreadDetail;

  it("says how it will unsubscribe before doing it", () => {
    navStore.setState({ view: "inbox" });
    show(newsletter);
    fireEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
    expect(screen.getByRole("dialog", { name: "Unsubscribe from Weekly?" })).toBeTruthy();
    expect(screen.getByText("Flint will send an unsubscribe email from your account to leave@weekly.test.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(flint.unsubscribe).not.toHaveBeenCalled();
  });

  it("then offers to archive what they already sent", async () => {
    navStore.setState({ view: "inbox" });
    run.mockClear();
    vi.mocked(flint.unsubscribe).mockResolvedValue({ method: "mailto" });
    vi.mocked(flint.listThreads).mockResolvedValue({ items: [{ id: 9 }, { id: 12 }], bundles: [], nextCursor: null } as never);
    show(newsletter);
    fireEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Unsubscribe" }).at(-1)!);
    expect(flint.unsubscribe).toHaveBeenCalledWith(41);
    fireEvent.click(await screen.findByRole("button", { name: "Also archive these" }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: "archive" }, [9, 12]));
    expect(flint.listThreads).toHaveBeenCalledWith({ view: "search", search: "from:news@weekly.test in:inbox", limit: 200 });
  });
});
