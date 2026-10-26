import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createMockApi } from "../../mock";
import { AppContext, type AppData } from "../../state/AppContext";
import { buildEntries } from "../../state/grouping";
import { listStore } from "../../state/listStore";
import { navStore } from "../../state/nav";
import { item } from "../../state/testFixtures";
import { ToastProvider } from "../../ui";
import { ThreadList } from "./ThreadList";
import { ThreadRow, type ThreadRowProps } from "./ThreadRow";
import { rowMenuItems } from "./rowMenu";
import { DRAFT_UNDO_MS } from "./mailCommands";

const NOW = Date.UTC(2026, 9, 25, 15);
const hoisted = vi.hoisted(() => ({
  openComposer: vi.fn(),
  openServerDraft: vi.fn(),
  deleteDraft: vi.fn(),
}));

vi.mock("../compose/composerStore", async (importOriginal) => ({ ...(await importOriginal<object>()), openComposer: hoisted.openComposer }));
vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<{ flint: object }>();
  return { ...real, flint: new Proxy(real.flint, { get: (t, k) => (k === "openServerDraft" ? hoisted.openServerDraft : k === "deleteDraft" ? hoisted.deleteDraft : Reflect.get(t, k)) }) };
});

const localDraft = item(-4, {
  subject: "(No subject)", snippet: "Here is the plan", hasDraft: true, draft: { draftId: 4, messageId: null },
  participants: [{ name: "Bob", address: "bob@x.test" }],
});
const serverDraft = item(9, {
  subject: "Started in Gmail web", snippet: "", hasDraft: true, draft: { draftId: null, messageId: 77 },
  participants: [{ name: "Dana", address: "dana@x.test" }],
});

const rowProps = (over: Partial<ThreadRowProps> = {}): ThreadRowProps => ({
  item: localDraft, compact: false, previewLines: 1, avatars: true, accountColor: null, open: false, cursor: false, checked: false, now: NOW,
  onSelect: vi.fn(), onPin: vi.fn(), onArchive: vi.fn(), onTrash: vi.fn(), onSnooze: vi.fn(), ...over,
});

describe("draft rows", () => {
  it("shows the Draft marker, recipients, subject and snippet, with only a delete action", () => {
    const p = rowProps();
    render(<ThreadRow {...p} />);
    expect(screen.getByText(/^Draft/).textContent).toContain("Draft");
    expect(screen.getByText("Bob")).toBeTruthy();
    expect(screen.getByText("(No subject)")).toBeTruthy();
    expect(screen.getByText("Here is the plan")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pin" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete draft", hidden: true }));
    expect(p.onTrash).toHaveBeenCalledWith(localDraft);
  });

  it("offers Open draft and Delete draft in the context menu", () => {
    const openDraft = vi.fn();
    const deleteDraft = vi.fn();
    const menu = rowMenuItems(localDraft, [localDraft.id], { run: vi.fn(), snooze: vi.fn(), move: vi.fn(), reply: vi.fn(), block: vi.fn(), openDraft, deleteDraft }, true);
    expect(menu.map((m) => ("label" in m ? m.label : ""))).toEqual(["Open draft", "Delete draft"]);
  });
});

describe("Drafts view clicks", () => {
  beforeEach(() => {
    // jsdom has no layout, so the virtualized list would render no rows.
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 900 });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 380 });
    hoisted.openComposer.mockReset();
    hoisted.openServerDraft.mockReset();
    hoisted.deleteDraft.mockReset();
  });

  async function mountDrafts() {
    const api = createMockApi({ now: NOW });
    const [accounts, sidebar, settings] = await Promise.all([api.listAccounts(), api.getSidebar(), api.getSettings()]);
    const data: AppData = { settings, updateSettings: async () => settings, accounts, refreshAccounts: () => undefined, sidebar, narrow: false, selfAddresses: [] };
    navStore.getState().go({ view: "drafts" });
    const items = [localDraft, serverDraft];
    listStore.setState({ raw: items, items, entries: buildEntries(items, []), status: "ready", nextCursor: null, error: null, queryKey: "drafts" });
    render(
      <ToastProvider>
        <AppContext.Provider value={data}><ThreadList /></AppContext.Provider>
      </ToastProvider>,
    );
  }

  it("opens a local draft in the composer", async () => {
    await mountDrafts();
    await act(async () => { fireEvent.click(screen.getByText("Here is the plan")); });
    expect(hoisted.openComposer).toHaveBeenCalledWith({ draftId: 4 });
    expect(hoisted.openServerDraft).not.toHaveBeenCalled();
  });

  it("turns a server draft into a local draft, then opens it", async () => {
    hoisted.openServerDraft.mockResolvedValue({ id: 12 });
    await mountDrafts();
    await act(async () => { fireEvent.click(screen.getByText("Started in Gmail web")); });
    expect(hoisted.openServerDraft).toHaveBeenCalledWith(77);
    expect(hoisted.openComposer).toHaveBeenCalledWith({ draftId: 12 });
  });

  it("says so when the server draft can't be opened", async () => {
    hoisted.openServerDraft.mockRejectedValue(new Error("offline"));
    await mountDrafts();
    await act(async () => { fireEvent.click(screen.getByText("Started in Gmail web")); });
    expect(hoisted.openComposer).not.toHaveBeenCalled();
    expect(await screen.findByText("Couldn't open the draft. Try again.")).toBeTruthy();
  });

  it("deletes a local draft from its row action once the Undo toast has passed", async () => {
    hoisted.deleteDraft.mockResolvedValue(undefined);
    await mountDrafts();
    vi.useFakeTimers();
    try {
      const row = screen.getByText("Here is the plan").closest("[role=option]") as HTMLElement;
      await act(async () => { fireEvent.click(row.querySelector("button[aria-label='Delete draft']")!); });
      expect(screen.queryByText("Here is the plan")).toBeNull();
      expect(screen.getByText("Draft deleted")).toBeTruthy();
      expect(hoisted.deleteDraft).not.toHaveBeenCalled();
      await act(async () => { vi.advanceTimersByTime(DRAFT_UNDO_MS); });
      expect(hoisted.deleteDraft).toHaveBeenCalledWith(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("brings a deleted draft back on Undo and never deletes it", async () => {
    await mountDrafts();
    vi.useFakeTimers();
    try {
      const row = screen.getByText("Here is the plan").closest("[role=option]") as HTMLElement;
      await act(async () => { fireEvent.click(row.querySelector("button[aria-label='Delete draft']")!); });
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Undo" })); });
      expect(screen.getByText("Here is the plan")).toBeTruthy();
      await act(async () => { vi.advanceTimersByTime(DRAFT_UNDO_MS * 2); });
      expect(hoisted.deleteDraft).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
