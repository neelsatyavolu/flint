import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ThreadRow, type ThreadRowProps } from "./ThreadRow";
import { BundleRow } from "./BundleRow";
import { AppContext, type AppData } from "../../state/AppContext";
import { navStore } from "../../state/nav";
import { listStore } from "../../state/listStore";
import { buildEntries } from "../../state/grouping";
import { bundle, item } from "../../state/testFixtures";
import { escapeStep } from "../../shell/useGlobalShortcuts";
import { Sidebar } from "../../shell/Sidebar";
import { ToastProvider } from "../../ui";
import { createMockApi } from "../../mock";

const NOW = Date.UTC(2026, 9, 25, 15);
const props = (over: Partial<ThreadRowProps> = {}): ThreadRowProps => ({
  item: item(1, { subject: "Quarterly plan", snippet: "Preview text", unreadCount: 1, messageCount: 4, hasAttachments: true, pinned: true }),
  compact: false, previewLines: 1, avatars: true, accountColor: null, open: false, cursor: false, checked: false, now: NOW,
  onSelect: vi.fn(), onPin: vi.fn(), onArchive: vi.fn(), onTrash: vi.fn(), onSnooze: vi.fn(), ...over,
});

describe("ThreadRow", () => {
  it("renders sender, subject, count, preview and unread state", () => {
    render(<ThreadRow {...props()} />);
    expect(screen.getByText("Carla Mendes")).toBeTruthy();
    expect(screen.getByText("Quarterly plan")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("Preview text")).toBeTruthy();
    expect(screen.getByText("Unread").className).toBe("sr-only");
    expect(screen.getByLabelText("Pinned")).toBeTruthy();
    expect(screen.getByLabelText("Has attachments")).toBeTruthy();
  });
  it("hides the preview when compact or zero lines", () => {
    const { rerender } = render(<ThreadRow {...props({ compact: true })} />);
    expect(screen.queryByText("Preview text")).toBeNull();
    rerender(<ThreadRow {...props({ previewLines: 0 })} />);
    expect(screen.queryByText("Preview text")).toBeNull();
  });
  it("marks drafts and receipts", () => {
    render(<ThreadRow {...props({ item: item(2, { hasDraft: true, receipt: { opened: 2, total: 3, status: "opened", lastOpenAt: null } }) })} />);
    expect(screen.getByText(/Draft/)).toBeTruthy();
    expect(screen.getByText("2/3")).toBeTruthy();
  });
  it("selection and quick actions call back", () => {
    const p = props();
    render(<ThreadRow {...p} />);
    fireEvent.click(screen.getByRole("option"));
    expect(p.onSelect).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Archive", hidden: true }));
    fireEvent.click(screen.getByRole("button", { name: "Trash", hidden: true }));
    fireEvent.click(screen.getByRole("button", { name: "Unpin", hidden: true }));
    fireEvent.click(screen.getByRole("button", { name: "Snooze", hidden: true }));
    expect(p.onArchive).toHaveBeenCalled();
    expect(p.onTrash).toHaveBeenCalled();
    expect(p.onPin).toHaveBeenCalled();
    expect(p.onSnooze).toHaveBeenCalled();
    expect(p.onSelect).toHaveBeenCalledTimes(1);
  });
  it("reflects open and checked", () => {
    render(<ThreadRow {...props({ open: true })} />);
    expect(screen.getByRole("option").getAttribute("aria-selected")).toBe("true");
  });
  it("names itself for the listbox and keeps quick actions out of the accessibility tree", () => {
    render(<ThreadRow {...props()} />);
    expect(screen.getByRole("option").id).toBe("row-t1");
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    expect(screen.getByRole("img", { name: "Has attachments" })).toBeTruthy();
  });
  it("checks the row from its avatar checkbox without opening it", () => {
    const p = props({ onCheck: vi.fn() });
    render(<ThreadRow {...p} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Quarterly plan" }));
    expect(p.onCheck).toHaveBeenCalledWith(p.item);
    expect(p.onSelect).not.toHaveBeenCalled();
  });
  it("starts a drag only when asked to", () => {
    const onDragStart = vi.fn();
    const { rerender } = render(<ThreadRow {...props()} />);
    expect(screen.getByRole("option").getAttribute("draggable")).toBeNull();
    rerender(<ThreadRow {...props({ onDragStart })} />);
    fireEvent.dragStart(screen.getByRole("option"));
    expect(onDragStart).toHaveBeenCalled();
  });
});

describe("BundleRow", () => {
  it("shows the category and opens it", () => {
    const onOpen = vi.fn();
    render(<BundleRow bundle={bundle("newsletters", NOW - 1000, 3)} compact={false} cursor={false} now={NOW} onOpen={onOpen} />);
    expect(screen.getByText("Newsletters")).toBeTruthy();
    expect(screen.getByText("3 new")).toBeTruthy();
    fireEvent.click(screen.getByRole("option"));
    expect(onOpen).toHaveBeenCalled();
    expect(screen.getByRole("option").id).toBe("row-b:newsletters");
  });
  it("shows only the distinct senders of the latest threads", () => {
    const b = {
      ...bundle("newsletters", NOW - 1000),
      latest: [
        { from: { name: "Tare", address: "t@x.test" }, subject: "Issue 4" },
        { from: { name: "Substack", address: "s@x.test" }, subject: "Weekly" },
        { from: { name: "Tare", address: "t@x.test" }, subject: "Issue 3" },
      ],
    };
    const { container } = render(<BundleRow bundle={b} compact={false} cursor={false} now={NOW} onOpen={vi.fn()} />);
    const senders = [...container.querySelectorAll("[data-sender]")];
    expect(senders.map((s) => s.querySelector('[role="img"]')?.getAttribute("aria-label"))).toEqual(["Tare", "Substack"]);
    expect(screen.getByText("Tare")).toBeTruthy();
    expect(screen.queryByText(/Issue 4/)).toBeNull();
  });
  it("offers bundle triage on hover without opening the bundle", () => {
    const onOpen = vi.fn();
    const onTriage = vi.fn();
    const b = bundle("notifications", NOW - 1000, 2);
    render(<BundleRow bundle={b} compact={false} cursor={false} now={NOW} onOpen={onOpen} onTriage={onTriage} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark all as read", hidden: true }));
    fireEvent.click(screen.getByRole("button", { name: "Archive all", hidden: true }));
    expect(onTriage.mock.calls).toEqual([[b, "read"], [b, "archive"]]);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("keyboard model", () => {
  it("Escape closes the innermost surface first", () => {
    const n = navStore.getState();
    n.go({ view: "inbox" });
    n.openCategory("newsletters");
    n.openThread(4);
    n.setSelected([4, 5]);
    expect(escapeStep()).toBe(true);
    expect(navStore.getState().selected).toEqual([]);
    expect(escapeStep()).toBe(true);
    expect(navStore.getState().openId).toBeNull();
    expect(escapeStep()).toBe(true);
    expect(navStore.getState().category).toBeUndefined();
    n.openSettings();
    expect(escapeStep()).toBe(true);
    expect(navStore.getState().settingsOpen).toBe(false);
    expect(escapeStep()).toBe(false);
  });
  it("Escape leaves an open overlay to its own handler", () => {
    navStore.getState().showOverlay("palette");
    expect(escapeStep()).toBe(false);
    navStore.getState().closeOverlay();
  });
  it("entries feed j/k stepping", () => {
    listStore.setState({ entries: buildEntries([item(1), item(2)], []) });
    expect(listStore.getState().entries.map((e) => e.key)).toEqual(["t1", "t2"]);
  });
});

describe("Sidebar", () => {
  it("shows the DESIGN order, counts and navigates", async () => {
    const api = createMockApi({ now: NOW });
    const [accounts, sidebar, settings] = await Promise.all([api.listAccounts(), api.getSidebar(), api.getSettings()]);
    const data: AppData = { settings, updateSettings: async () => settings, accounts, refreshAccounts: () => undefined, sidebar, narrow: false, selfAddresses: [] };
    navStore.getState().go({ view: "inbox" });
    render(
      <ToastProvider>
        <AppContext.Provider value={data}><Sidebar rail={false} /></AppContext.Provider>
      </ToastProvider>,
    );
    const labels = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    const order = ["Home", "Inbox", "Agent Activity", "Pins", "Drafts", "Sent", "Scheduled", "Snoozed", "Trash", "Spam", "Archive", "Blocked", "Read Receipts", "More", "Agents & CLI", "Settings"];
    let at = -1;
    for (const name of order) {
      const idx = labels.findIndex((l, i) => i > at && l.startsWith(name));
      expect(idx, name).toBeGreaterThan(at);
      at = idx;
    }
    expect(screen.getByRole("button", { name: /^Agent Activity/ }).textContent).toContain(String(sidebar.counts.awaitingApproval));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sent" })); });
    expect(navStore.getState().view).toBe("sent");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Settings" })); });
    expect(navStore.getState().settingsOpen).toBe(true);
    navStore.getState().closeSettings();
  });
});
