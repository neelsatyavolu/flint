import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { MessageView } from "@flint/core";
import { ToastProvider } from "../../ui";
import { navStore } from "../../state/nav";
import { AppContext, type AppData } from "../../state/AppContext";
import { defaultSettings } from "../../mock/fixtures";
import { openComposer } from "../compose/composerStore";
import { flint } from "../../lib/api";
import { MessageItem } from "./MessageItem";

vi.mock("../compose/composerStore", () => ({ openComposer: vi.fn() }));
vi.mock("../../lib/avatarImages", () => ({ useAvatarImage: () => null }));
vi.mock("../../lib/api", () => ({ flint: { subscribe: vi.fn(() => () => {}), blockSender: vi.fn(async () => undefined), unblockSender: vi.fn() } }));

const addr = (name: string, address: string) => ({ name, address });
const msg = {
  id: 7, accountId: "a1", threadId: 3, messageId: "<a@x>", from: [addr("Carla Mendes", "carla@school.org")], to: [addr("Alex", "alex@me.dev")],
  cc: [addr("Priya", "p@x.com")], bcc: [], replyTo: [], subject: "Hi", date: Date.UTC(2026, 9, 23), seen: true, pinned: false, isFromMe: false,
  snippet: "snip", html: null, text: "Hello", bodyLoaded: true, remoteImages: "allowed", hasTrackers: false, attachments: [], unsubscribe: null, receipt: null,
} as unknown as MessageView;
const app = { settings: defaultSettings(), accounts: [], selfAddresses: ["alex@me.dev"] } as unknown as AppData;
const onToggle = vi.fn();
const show = () =>
  render(
    <ToastProvider>
      <AppContext.Provider value={app}>
        <MessageItem message={msg} expanded selfAddresses={["alex@me.dev"]} onToggle={onToggle} onUpdated={() => undefined} now={Date.UTC(2026, 9, 25)} />
      </AppContext.Provider>
    </ToastProvider>,
  );

beforeEach(() => {
  onToggle.mockClear();
  vi.mocked(openComposer).mockClear();
  navStore.setState({ searchOpen: false, search: "" });
});

describe("person card", () => {
  it("opens from the sender name without collapsing the message", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /Carla Mendes, carla@school.org/ }));
    expect(screen.getByRole("dialog", { name: "Carla Mendes" })).toBeTruthy();
    expect(screen.getAllByText("carla@school.org").length).toBeGreaterThan(0);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("starts a new message to them", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /Carla Mendes, carla@school.org/ }));
    fireEvent.click(screen.getByRole("button", { name: "New message" }));
    expect(openComposer).toHaveBeenCalledWith({ mode: "new", to: [addr("Carla Mendes", "carla@school.org")] });
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("searches all their mail, or only their attachments", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /Carla Mendes, carla@school.org/ }));
    fireEvent.click(screen.getByRole("button", { name: "All mail from Carla Mendes" }));
    expect(navStore.getState()).toMatchObject({ searchOpen: true, search: "from:carla@school.org" });
    navStore.setState({ searchOpen: false });
    fireEvent.click(screen.getByRole("button", { name: /Carla Mendes, carla@school.org/ }));
    fireEvent.click(screen.getByRole("button", { name: "Attachments from Carla Mendes" }));
    expect(navStore.getState().search).toBe("from:carla@school.org has:attachment");
  });

  it("blocks the sender", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /Carla Mendes, carla@school.org/ }));
    fireEvent.click(screen.getByRole("button", { name: "Block sender" }));
    expect(flint.blockSender).toHaveBeenCalledWith("carla@school.org");
    expect(await screen.findByText("Blocked carla@school.org. Their mail goes to Blocked")).toBeTruthy();
  });

  it("opens from a row in the recipients popover, with a way back", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /Recipients:/ }));
    fireEvent.click(screen.getByRole("button", { name: /Priya, p@x.com/ }));
    expect(screen.getByRole("button", { name: "All mail from Priya" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Recipients" }));
    expect(screen.getByText("Cc")).toBeTruthy();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("does not offer to block yourself", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /Recipients:/ }));
    fireEvent.click(screen.getByRole("button", { name: /Alex, alex@me.dev/ }));
    expect(screen.getByRole("button", { name: "Copy address" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Block sender" })).toBeNull();
  });
});
