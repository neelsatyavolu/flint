import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ThreadDetail } from "@flint/core";
import { ToastProvider } from "../../ui";
import { navStore } from "../../state/nav";
import { AppContext, type AppData } from "../../state/AppContext";
import { defaultSettings } from "../../mock/fixtures";
import { ReaderToolbar } from "./ReaderToolbar";
import { PRINT_EVENT } from "./printThread";

const run = vi.fn();
vi.mock("../../state/useActions", () => ({ useThreadActions: () => ({ run }) }));
vi.mock("../../lib/api", () => ({ flint: { subscribe: vi.fn(() => () => {}), blockSender: vi.fn(async () => undefined), unblockSender: vi.fn() } }));

const app = { settings: defaultSettings(), accounts: [], selfAddresses: [] } as unknown as AppData;
const thread = {
  id: 9, accountId: "a1", subject: "Win a prize", category: "people", pinned: false, muted: false, snoozedUntil: null, draftIds: [],
  messages: [{ id: 1, threadId: 9, isFromMe: false, from: [{ name: "Prize", address: "prize@x.test" }], to: [], cc: [], bcc: [] }],
} as unknown as ThreadDetail;
const show = () => render(<ToastProvider><AppContext.Provider value={app}><ReaderToolbar thread={thread} /></AppContext.Provider></ToastProvider>);

beforeEach(() => run.mockClear());

describe("ReaderToolbar", () => {
  it("shows Not spam in place of Archive in the Spam view, and in the More menu", () => {
    navStore.setState({ view: "spam" });
    show();
    expect(screen.queryByRole("button", { name: /Archive/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Not spam/ }));
    expect(run).toHaveBeenCalledWith({ type: "spam", spam: false }, [9]);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.queryByRole("menuitem", { name: /Mark as spam/ })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: /Not spam/ }));
    expect(run).toHaveBeenLastCalledWith({ type: "spam", spam: false }, [9]);
  });

  it("keeps Archive and Mark as spam in the inbox", () => {
    navStore.setState({ view: "inbox" });
    show();
    expect(screen.getByRole("button", { name: /Archive/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Mark as spam/ }));
    expect(run).toHaveBeenCalledWith({ type: "spam", spam: true }, [9]);
  });

  it("Print asks the reader to print the open thread", () => {
    navStore.setState({ view: "inbox" });
    const onPrint = vi.fn();
    window.addEventListener(PRINT_EVENT, onPrint);
    show();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Print/ }));
    expect(onPrint).toHaveBeenCalledTimes(1);
    window.removeEventListener(PRINT_EVENT, onPrint);
  });

  it("Block sender says where their mail goes, with Undo", async () => {
    navStore.setState({ view: "inbox" });
    show();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Block sender" }));
    expect(await screen.findByText("Blocked prize@x.test. Their mail goes to Blocked")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  });
});
