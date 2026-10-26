import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { NavView } from "../../state/nav";
import { flint } from "../../lib/api";
import { createMockApi } from "../../mock";
import { AppContext, type AppData } from "../../state/AppContext";
import { listStore } from "../../state/listStore";
import { navStore } from "../../state/nav";
import { item } from "../../state/testFixtures";
import { ToastProvider } from "../../ui";
import { BatchBar } from "./BatchBar";
import { rowMenuItems } from "./rowMenu";

async function mount(view: NavView) {
  const api = createMockApi({ now: Date.now() });
  const [accounts, sidebar, settings] = await Promise.all([api.listAccounts(), api.getSidebar(), api.getSettings()]);
  const data: AppData = { settings, updateSettings: async () => settings, accounts, refreshAccounts: () => undefined, sidebar, narrow: false, selfAddresses: [] };
  const rows = [item(1, { category: "notifications" }), item(2, { category: "notifications" }), item(3)];
  listStore.setState({ raw: rows, items: rows });
  navStore.getState().go({ view });
  navStore.getState().setSelected([1, 2, 3]);
  render(
    <ToastProvider>
      <AppContext.Provider value={data}><BatchBar /></AppContext.Provider>
    </ToastProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navStore.getState().go({ view: "inbox" });
});

describe("BatchBar", () => {
  it("archives in the inbox and offers spam and every category for a mixed selection", async () => {
    await mount("inbox");
    expect(screen.getByText("3 selected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const labels = (await screen.findAllByRole("menuitem")).map((m) => m.textContent ?? "");
    expect(labels.some((l) => l.startsWith("Mark as spam"))).toBe(true);
    expect(labels.filter((l) => l.startsWith("Move to "))).toHaveLength(3);
  });

  it("moves to the inbox instead of archiving outside the inbox", async () => {
    const moveToInbox = vi.spyOn(flint, "moveToInbox").mockResolvedValue({ undoToken: "u" });
    await mount("archive");
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Move to Inbox" })); });
    expect(moveToInbox).toHaveBeenCalledWith([1, 2, 3]);
  });

  it("offers Not spam in Spam", async () => {
    const markSpam = vi.spyOn(flint, "markSpam").mockResolvedValue({ undoToken: "u" });
    await mount("spam");
    expect(screen.queryByRole("button", { name: "Move to Inbox" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Not spam" })); });
    expect(markSpam).toHaveBeenCalledWith([1, 2, 3], false);
  });
});

describe("row menu in Spam", () => {
  it("offers Not spam instead of Mark as spam", () => {
    const run = vi.fn();
    const h = { run, snooze: vi.fn(), move: vi.fn(), reply: vi.fn(), block: vi.fn() };
    const spam = rowMenuItems(item(1), [1], h, false, "spam").find((m) => m.id === "spam");
    expect(spam && "label" in spam ? spam.label : "").toBe("Not spam");
    if (spam && "onSelect" in spam) spam.onSelect();
    expect(run).toHaveBeenCalledWith({ type: "spam", spam: false }, [1]);
    const inbox = rowMenuItems(item(1), [1], h, true, "inbox").find((m) => m.id === "spam");
    expect(inbox && "label" in inbox ? inbox.label : "").toBe("Mark as spam");
  });
});
