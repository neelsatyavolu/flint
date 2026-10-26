import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Account, Settings, SidebarData } from "@flint/core";
import { flint } from "../../lib/api";
import type { AppCommands } from "../../shell/useAppCommands";
import { AppContext, type AppData } from "../../state/AppContext";
import { navStore } from "../../state/nav";
import { item } from "../../state/testFixtures";
import { ToastProvider } from "../../ui";
import { closeComposer, openComposer, resetComposerStore, useComposers } from "../compose/composerStore";
import { COMPOSER_COMMAND_EVENT } from "./composerBridge";
import { CommandPalette } from "./CommandPalette";

let settings: Settings;
let accounts: Account[];
let sidebar: SidebarData;
const updateSettings = vi.fn(async () => settings);
const cmds = {
  inMailView: () => true, hasTarget: () => true, targetCategory: () => null, compose: vi.fn(), archive: vi.fn(), trash: vi.fn(), togglePin: vi.fn(), snooze: vi.fn(), move: vi.fn(),
  toggleRead: vi.fn(), toggleMute: vi.fn(), spam: vi.fn(), reply: vi.fn(), setCategory: vi.fn(), undo: vi.fn(), toggleSidebar: vi.fn(),
} as unknown as AppCommands;

function Probe() {
  return <output data-testid="composers">{useComposers().length}</output>;
}

function mount() {
  const value = { settings, updateSettings, accounts, refreshAccounts: () => undefined, sidebar, narrow: false, selfAddresses: [] } as AppData;
  return render(
    <ToastProvider>
      <AppContext.Provider value={value}>
        <CommandPalette cmds={cmds} />
        <Probe />
      </AppContext.Provider>
    </ToastProvider>,
  );
}

const input = () => screen.getByRole("combobox", { name: "Command palette" }) as HTMLInputElement;
const type = (value: string) => fireEvent.change(input(), { target: { value } });
const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(input(), { key, ...init });
const options = () => screen.getAllByRole("option").map((o) => o.textContent ?? "");
const opt = (name: RegExp) => screen.getAllByRole("option").find((o) => name.test(o.textContent ?? ""))!;
const page = (items: ReturnType<typeof item>[]) => ({ items, bundles: [], nextCursor: null });

beforeEach(async () => {
  localStorage.clear();
  settings = await flint.getSettings();
  accounts = await flint.listAccounts();
  sidebar = await flint.getSidebar();
  navStore.setState({ overlay: "palette", openId: 1, selected: [], cursorKey: null, searchOpen: false, search: "", category: undefined, view: "inbox" });
  vi.spyOn(flint, "listThreads").mockResolvedValue(page([]));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  resetComposerStore();
  navStore.setState({ overlay: null, overlayIds: [], openId: null, selected: [] });
});

describe("CommandPalette", () => {
  it("is a combobox over a listbox and keeps focus in the input", async () => {
    mount();
    await screen.findByRole("listbox");
    expect(document.activeElement).toBe(input());
    expect(input().getAttribute("aria-controls")).toBe(screen.getByRole("listbox").id);
    const first = screen.getAllByRole("option")[0]!;
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(input().getAttribute("aria-activedescendant")).toBe(first.id);

    press("ArrowDown");
    const second = screen.getAllByRole("option")[1]!;
    expect(second.getAttribute("aria-selected")).toBe("true");
    expect(input().getAttribute("aria-activedescendant")).toBe(second.id);
    fireEvent.mouseDown(screen.getAllByRole("option")[3]!);
    expect(document.activeElement).toBe(input());
  });

  it("moves with the arrows, wraps, and runs the active row with Enter", async () => {
    mount();
    await screen.findByRole("listbox");
    press("ArrowUp");
    const last = screen.getAllByRole("option").at(-1)!;
    expect(last.getAttribute("aria-selected")).toBe("true");
    press("ArrowDown");
    expect(screen.getAllByRole("option")[0]!.getAttribute("aria-selected")).toBe("true");
    press("ArrowDown", { ctrlKey: true, key: "n" });
    press("Enter");
    expect(navStore.getState().overlay).toBeNull();
    expect(cmds.archive).not.toHaveBeenCalled();
    expect(cmds.trash).toHaveBeenCalledTimes(1);
  });

  it("runs a command found by typing, with the match highlighted", async () => {
    mount();
    type("arch");
    await waitFor(() => expect(opt(/^Archive/)).toBeTruthy());
    const row = opt(/^Archive/);
    expect(row.querySelector("mark")?.textContent).toBe("Arch");
    press("Enter");
    expect(cmds.archive).toHaveBeenCalledTimes(1);
  });

  it("shows how many threads the actions apply to and hides single-thread actions", async () => {
    navStore.setState({ selected: [1, 2, 3] });
    mount();
    const actions = await screen.findByRole("group", { name: /Actions/ });
    expect(within(actions).getByText("3 threads")).toBeTruthy();
    expect(options().some((o) => o.startsWith("Reply"))).toBe(false);
    expect(opt(/^Archive/)).toBeTruthy();
  });

  it("lists Recent for the commands you ran before", async () => {
    localStorage.setItem("flint.palette.usage", JSON.stringify({ sync: { n: 3, last: Date.now() }, "go:Sent": { n: 1, last: Date.now() - 1000 } }));
    mount();
    const recent = await screen.findByRole("group", { name: "Recent" });
    expect(within(recent).getAllByRole("option").map((o) => o.textContent)).toEqual([expect.stringContaining("Sync now"), expect.stringContaining("Sent")]);
  });

  it("remembers what ran, so it appears under Recent next time", async () => {
    const first = mount();
    type("sync now");
    press("Enter");
    first.unmount();
    navStore.setState({ overlay: "palette" });
    mount();
    expect(within(await screen.findByRole("group", { name: "Recent" })).getByText("Sync now")).toBeTruthy();
  });

  describe("prefix modes", () => {
    it("> shows commands only", async () => {
      mount();
      type(">");
      await waitFor(() => expect(opt(/^Archive/)).toBeTruthy());
      expect(options().some((o) => o.startsWith("Inbox: People"))).toBe(false);
      expect(options().some((o) => o.startsWith("Home"))).toBe(false);
      expect(input().placeholder).toBe("Run a command");
    });

    it("# lists folders and categories, and opens one", async () => {
      mount();
      type("#peo");
      press("Enter");
      expect(navStore.getState().category).toBe("people");
    });

    it("/ searches mail live and Enter on a result opens that thread", async () => {
      vi.mocked(flint.listThreads).mockResolvedValue(page([item(42, { subject: "Budget review" })]));
      mount();
      type("/budget");
      const row = await screen.findByRole("option", { name: /Budget review/ });
      expect(flint.listThreads).toHaveBeenCalledWith({ view: "search", search: "budget", limit: 8 });
      expect(row.getAttribute("aria-selected")).toBe("true");
      press("Enter");
      expect(navStore.getState().openId).toBe(42);
    });

    it("/ falls back to full search with the typed text", async () => {
      mount();
      type("/from:carla");
      const row = await screen.findByRole("option", { name: /Search all mail for/ });
      expect(row.getAttribute("aria-selected")).toBe("true");
      press("Enter");
      expect(navStore.getState()).toMatchObject({ searchOpen: true, search: "from:carla", overlay: null });
    });

    it("@ finds contacts without searching mail, and Enter starts a message", async () => {
      vi.spyOn(flint, "suggestContacts").mockResolvedValue([{ email: "carla@x.test", name: "Carla Mendes", score: 9 }]);
      mount();
      type("@car");
      const row = await screen.findByRole("option", { name: /Write to Carla Mendes/ });
      expect(flint.suggestContacts).toHaveBeenCalledWith("car", 5);
      expect(flint.listThreads).not.toHaveBeenCalled();
      expect(row).toBeTruthy();
      press("Enter");
      expect(screen.getByTestId("composers").textContent).toBe("1");
    });

    it("shows a helpful empty state for an empty mode", async () => {
      mount();
      type("/");
      expect((await screen.findAllByText("Search all mail")).length).toBeGreaterThan(0);
      expect(screen.getByText(/from:, to:, has:attachment/)).toBeTruthy();
    });

    it("the footer prefixes switch modes", async () => {
      mount();
      fireEvent.click(await screen.findByRole("button", { name: /mail/ }));
      expect(input().value).toBe("/");
      expect(document.activeElement).toBe(input());
    });
  });

  describe("live mail search in the main list", () => {
    it("adds the top threads under Mail once text is typed", async () => {
      vi.mocked(flint.listThreads).mockResolvedValue(page([item(5, { subject: "Invoice 2291" }), item(6, { subject: "Invoice reminder" })]));
      mount();
      type("invoice");
      const mail = await screen.findByRole("group", { name: "Mail" });
      expect(within(mail).getAllByRole("option")).toHaveLength(2);
      expect(screen.getByRole("option", { name: /Search all mail for/ })).toBeTruthy();
      expect(screen.getByRole("option", { name: /Ask AI: invoice/ })).toBeTruthy();
    });

    it("debounces typing into one request", async () => {
      mount();
      type("in");
      type("inv");
      type("invo");
      await waitFor(() => expect(flint.listThreads).toHaveBeenCalledTimes(1));
      expect(flint.listThreads).toHaveBeenCalledWith(expect.objectContaining({ search: "invo" }));
    });

    it("keeps the earlier rows in place while a slow search runs, with one loading row below them", async () => {
      let release: (p: ReturnType<typeof page>) => void = () => undefined;
      vi.mocked(flint.listThreads).mockReturnValue(new Promise((r) => { release = r; }));
      mount();
      type("invoice");
      const search = await screen.findByRole("option", { name: /Search all mail for/ });
      const status = await within(screen.getByRole("listbox")).findByText("Searching mail");
      expect(screen.getAllByRole("option").at(-1)).toBe(screen.getByRole("option", { name: /Ask AI/ }));
      expect(search.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      await act(async () => release(page([item(9, { subject: "Invoice 9" })])));
      await screen.findByRole("option", { name: /Invoice 9/ });
      expect(within(screen.getByRole("listbox")).queryByText("Searching mail")).toBeNull();
    });

    it("says so when search fails", async () => {
      vi.mocked(flint.listThreads).mockRejectedValue(new Error("offline"));
      mount();
      type("invoice");
      expect(await screen.findByText(/Couldn't search mail/)).toBeTruthy();
    });

    it("drops answers for text that was replaced", async () => {
      const resolvers: Record<string, (p: ReturnType<typeof page>) => void> = {};
      vi.mocked(flint.listThreads).mockImplementation((q) => new Promise((r) => { resolvers[q.search ?? ""] = r; }));
      mount();
      type("alpha");
      await waitFor(() => expect(resolvers.alpha).toBeDefined());
      type("beta");
      await waitFor(() => expect(resolvers.beta).toBeDefined());
      await act(async () => resolvers.beta!(page([item(2, { subject: "About beta" })])));
      await act(async () => resolvers.alpha!(page([item(1, { subject: "About alpha" })])));
      await screen.findByRole("option", { name: /About beta/ });
      expect(screen.queryByRole("option", { name: /About alpha/ })).toBeNull();
    });
  });

  describe("nested pages", () => {
    it("opens Snooze with Enter, filters, and snoozes the thread", async () => {
      const snooze = vi.spyOn(flint, "snooze");
      mount();
      type("snooze");
      await waitFor(() => expect(opt(/^Snooze/)).toBeTruthy());
      press("Enter");
      expect(input().placeholder).toBe("Filter snooze until");
      expect(input().value).toBe("");
      expect(screen.getByText("Snooze until", { selector: "span" })).toBeTruthy();
      expect(screen.getByRole("option", { name: /Tomorrow morning/ })).toBeTruthy();
      type("tomorrow");
      expect(options()).toHaveLength(1);
      press("Enter");
      await waitFor(() => expect(snooze).toHaveBeenCalledWith([1], expect.any(Number)));
      expect(navStore.getState().overlay).toBeNull();
    });

    it("opens a page with the right arrow only when the caret is at the end, and with Tab", async () => {
      mount();
      type("theme");
      input().setSelectionRange(2, 2);
      press("ArrowRight");
      expect(input().placeholder).not.toMatch(/^Filter/);
      input().setSelectionRange(5, 5);
      press("ArrowRight");
      expect(input().placeholder).toBe("Filter theme");
      press("Escape");
      press("Tab");
      expect(input().placeholder).toBe("Filter theme");
      expect(document.activeElement).toBe(input());
    });

    it("Esc steps back out of a page, keeping the old query, before it closes", async () => {
      mount();
      type("snooze");
      press("Enter");
      expect(input().placeholder).toBe("Filter snooze until");
      press("Escape");
      expect(input().value).toBe("snooze");
      expect(navStore.getState().overlay).toBe("palette");
      expect(opt(/^Snooze/).getAttribute("aria-selected")).toBe("true");
      press("Escape");
      await waitFor(() => expect(navStore.getState().overlay).toBeNull());
    });

    it("Backspace on an empty filter goes back too", async () => {
      mount();
      type("layout");
      press("Enter");
      press("Backspace");
      expect(input().value).toBe("layout");
    });

    it("switches the theme and confirms it", async () => {
      mount();
      type("theme");
      press("Enter");
      expect(within(screen.getByRole("option", { name: /System/ })).getByLabelText("Current")).toBeTruthy();
      fireEvent.click(screen.getByRole("option", { name: /Dark/ }));
      expect(updateSettings).toHaveBeenCalledWith({ appearance: { theme: "dark" } });
      expect(await screen.findByText("Theme set to dark")).toBeTruthy();
    });

    it("moves to a folder of the thread's account", async () => {
      const move = vi.spyOn(flint, "moveToFolder");
      mount();
      type("move to folder");
      press("Enter");
      const folder = screen.getAllByRole("option").find((o) => !/Inbox|Archive|Trash|Spam/.test(o.textContent ?? ""));
      expect(folder).toBeTruthy();
      fireEvent.click(folder!);
      await waitFor(() => expect(move).toHaveBeenCalled());
    });

    it("moves to a category, marking the current one", async () => {
      mount();
      type("move to category");
      press("Enter");
      fireEvent.click(screen.getByRole("option", { name: /Newsletters/ }));
      await waitFor(() => expect(navStore.getState().overlay).toBeNull());
    });

    it("applies a template and switches From in the open composer", async () => {
      vi.spyOn(flint, "listTemplates").mockResolvedValue([{ id: 3, name: "Intro", subject: "Hello", html: "<p>Hi</p>" }]);
      openComposer({ mode: "new" });
      const seen: unknown[] = [];
      const listener = (e: Event) => seen.push((e as CustomEvent).detail);
      window.addEventListener(COMPOSER_COMMAND_EVENT, listener);
      mount();
      type("insert template");
      press("Enter");
      fireEvent.click(await screen.findByRole("option", { name: /Intro/ }));
      expect(seen).toEqual([{ composerId: expect.any(String), template: expect.objectContaining({ id: 3 }) }]);

      navStore.setState({ overlay: "palette" });
      cleanup();
      mount();
      type("send from");
      press("Enter");
      const alias = screen.getAllByRole("option")[1]!;
      fireEvent.click(alias);
      expect(seen[1]).toEqual({ composerId: expect.any(String), from: expect.stringContaining("@") });
      window.removeEventListener(COMPOSER_COMMAND_EVENT, listener);
      closeComposer((seen[0] as { composerId: string }).composerId);
    });

    it("only offers composer commands while a composer is open", async () => {
      mount();
      type("insert template");
      await screen.findByRole("option", { name: /Search all mail for/ });
      expect(options().some((o) => o.startsWith("Insert template"))).toBe(false);
    });
  });

  describe("quick toggles", () => {
    it("flips Focused inbox and says what happened", async () => {
      mount();
      type("focused");
      press("Enter");
      expect(updateSettings).toHaveBeenCalledWith({ inbox: { focused: !settings.inbox.focused } });
      expect(await screen.findByText(/Focused inbox (on|off)/)).toBeTruthy();
    });
  });

  describe("navigation", () => {
    it("jumps to a settings section and an +AI sub-page", async () => {
      mount();
      type("writing");
      const row = await screen.findByRole("option", { name: /\+AI, Writing/ });
      fireEvent.click(row);
      expect(navStore.getState()).toMatchObject({ settingsOpen: true, settingsSection: "ai/writing" });
    });

    it("goes to each account's inbox", async () => {
      expect(accounts.length).toBeGreaterThan(1);
      mount();
      type(`inbox: ${accounts[1]!.email}`);
      press("Enter");
      expect(navStore.getState()).toMatchObject({ view: "inbox", accountId: accounts[1]!.id });
    });
  });

  it("shows a helpful empty state in a page with no match", async () => {
    mount();
    type("theme");
    press("Enter");
    type("zzzz");
    expect((await screen.findAllByText(/Nothing matches/)).length).toBeGreaterThan(0);
  });

  it("closes on an outside click", async () => {
    mount();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(navStore.getState().overlay).toBeNull());
  });
});
