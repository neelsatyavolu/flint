import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ThreadDetail } from "@flint/core";
import { ToastProvider } from "../../ui";
import { navStore } from "../../state/nav";
import { AppContext, type AppData } from "../../state/AppContext";
import { defaultSettings } from "../../mock/fixtures";
import { ThreadHeader } from "./Reader";

const run = vi.fn();
vi.mock("../../state/useActions", () => ({ useThreadActions: () => ({ run }) }));
vi.mock("../../lib/api", () => ({ flint: { subscribe: vi.fn(() => () => {}), unsubscribe: vi.fn() } }));

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
