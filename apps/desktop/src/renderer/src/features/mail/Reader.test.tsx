import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Draft, MessageView } from "@flint/core";
import { MessageItem, hasSingleRecipient } from "./MessageItem";
import { Reader } from "./Reader";
import { navStore } from "../../state/nav";
import { DraftCard, draftPreviewText } from "./DraftCard";
import { FrameGateContext } from "./frameGate";
import { ToastProvider } from "../../ui";
import { AppContext, type AppData } from "../../state/AppContext";
import { defaultSettings } from "../../mock/fixtures";
import { useInlineReply } from "../../state/inlineReply";
import { flint } from "../../lib/api";

vi.mock("./useThread", () => ({ useThread: () => ({ thread: undefined, error: undefined, refetch: () => undefined }) }));
vi.mock("./ReaderToolbar", () => ({ ReaderToolbar: () => null }));
vi.mock("../../lib/avatarImages", () => ({ useAvatarImage: () => null }));
vi.mock("../../lib/api", () => ({ flint: { getDraft: vi.fn(), deleteDraft: vi.fn(), sendDraft: vi.fn(), markRead: vi.fn(), blockSender: vi.fn(), unsubscribe: vi.fn(), subscribe: vi.fn(() => () => {}) } }));

const addr = (name: string, address: string) => ({ name, address });
const msg = (over: Partial<MessageView> = {}): MessageView => ({
  id: 7, accountId: "a1", threadId: 3, messageId: "<a@x>", from: [addr("Carla Mendes", "carla@school.org")], to: [addr("Alex", "alex@me.dev"), addr("Rodney", "r@x.com")],
  cc: [addr("Priya", "p@x.com"), addr("Tomas", "t@x.com")], bcc: [], replyTo: [], subject: "Hi", date: Date.UTC(2026, 9, 23, 20, 43), seen: true, pinned: false,
  isFromMe: false, snippet: "snip", html: null, text: "Hello there", bodyLoaded: true, remoteImages: "allowed", hasTrackers: false, attachments: [], unsubscribe: null, receipt: null, ...over,
});
const app = { settings: defaultSettings(), updateSettings: async () => defaultSettings(), accounts: [], refreshAccounts: () => undefined, sidebar: undefined, narrow: false, selfAddresses: ["alex@me.dev"] } as unknown as AppData;
const wrap = (ui: React.ReactElement) => render(<ToastProvider><AppContext.Provider value={app}>{ui}</AppContext.Provider></ToastProvider>);
const props = { expanded: true, selfAddresses: ["alex@me.dev"], onToggle: vi.fn(), onUpdated: vi.fn(), now: Date.UTC(2026, 9, 25) };

beforeEach(() => useInlineReply.getState().close());

describe("MessageItem card", () => {
  it("shows 'to Name +N' and lists everyone in the popover", () => {
    wrap(<MessageItem message={msg()} {...props} />);
    const btn = screen.getByRole("button", { name: /Recipients: me and 3 more/ });
    expect(btn.textContent).toBe("me +3");
    fireEvent.click(btn);
    expect(screen.getByText("tomas@x.com".replace("tomas", "t"))).toBeTruthy();
    expect(screen.getByText("carla@school.org")).toBeTruthy();
  });
  it("always shows Reply all and Forward, and they open the inline reply", () => {
    wrap(<MessageItem message={msg()} {...props} />);
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reply all/ }));
    expect(useInlineReply.getState().request).toMatchObject({ threadId: 3, messageId: 7, mode: "replyAll" });
    fireEvent.click(screen.getByRole("button", { name: /Forward/ }));
    expect(useInlineReply.getState().request?.mode).toBe("forward");
  });
  it("adds Reply when there is a single recipient", () => {
    const m = msg({ to: [addr("Alex", "alex@me.dev")], cc: [] });
    expect(hasSingleRecipient(m, ["alex@me.dev"])).toBe(true);
    wrap(<MessageItem message={m} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(useInlineReply.getState().request?.mode).toBe("reply");
  });
  it("collapses to a one-line row", () => {
    wrap(<MessageItem message={msg()} {...props} expanded={false} />);
    expect(screen.getByText("snip")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Forward/ })).toBeNull();
  });
});

describe("DraftCard", () => {
  const draft = { id: 5, accountId: "a1", from: "alex@me.dev", mode: "reply", sourceMessageId: 7, threadId: 3, to: [addr("Carla Mendes", "carla@school.org")], cc: [], bcc: [], subject: "Re: Hi", html: "<p>Thanks, see you</p><p>Alex</p>", quotedHtml: "", attachments: [] } as unknown as Draft;
  it("renders the tag, recipient and Delete / Edit / Send", async () => {
    vi.mocked(flint.getDraft).mockResolvedValue(draft);
    const del = vi.mocked(flint.deleteDraft).mockResolvedValue(undefined);
    const changed = vi.fn();
    wrap(<DraftCard draftId={5} threadId={3} messageId={7} reloadKey={0} onChanged={changed} />);
    await waitFor(() => expect(screen.getByText("DRAFT")).toBeTruthy());
    expect(screen.getByText("Carla Mendes")).toBeTruthy();
    expect(screen.getByText(/Thanks, see you/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(useInlineReply.getState().request).toMatchObject({ threadId: 3, messageId: 7, mode: "reply", draftId: 5 });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Delete" })); });
    expect(del).toHaveBeenCalledWith(5);
    expect(changed).toHaveBeenCalled();
  });
  it("holds the thread's reveal until the draft has loaded, then lets it go", async () => {
    let resolve: (d: Draft) => void = () => undefined;
    vi.mocked(flint.getDraft).mockReturnValue(new Promise<Draft>((r) => (resolve = r)));
    const ended = vi.fn();
    const begin = vi.fn(() => ended);
    wrap(
      <FrameGateContext.Provider value={{ begin }}>
        <DraftCard draftId={5} threadId={3} messageId={7} reloadKey={0} onChanged={vi.fn()} />
      </FrameGateContext.Provider>,
    );
    expect(begin).toHaveBeenCalledTimes(1);
    expect(ended).not.toHaveBeenCalled();
    await act(async () => resolve(draft));
    expect(ended).toHaveBeenCalledTimes(1);
    expect(screen.getByText("DRAFT")).toBeTruthy();
  });
  it("lets the reveal go when the draft cannot be loaded", async () => {
    vi.mocked(flint.getDraft).mockRejectedValue(new Error("gone"));
    const ended = vi.fn();
    wrap(
      <FrameGateContext.Provider value={{ begin: () => ended }}>
        <DraftCard draftId={5} threadId={3} messageId={7} reloadKey={0} onChanged={vi.fn()} />
      </FrameGateContext.Provider>,
    );
    await waitFor(() => expect(ended).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("DRAFT")).toBeNull();
  });
  it("turns draft HTML into plain preview text", () => {
    expect(draftPreviewText("<p>One</p><p>Two<br>three</p>")).toBe("One\nTwo\nthree");
  });
});

describe("Reader reply dock across threads", () => {
  it("ends the open reply when another thread is opened, so returning does not start a second draft", () => {
    navStore.setState({ openId: 3 });
    useInlineReply.getState().open({ threadId: 3, messageId: 7, mode: "reply" });
    useInlineReply.getState().setLiveDraft(11);
    wrap(<Reader />);
    expect(useInlineReply.getState().request).not.toBeNull();
    act(() => navStore.setState({ openId: 4 }));
    expect(useInlineReply.getState().request).toBeNull();
    expect(useInlineReply.getState().liveDraftId).toBeNull();
    act(() => navStore.setState({ openId: 3 }));
    expect(useInlineReply.getState().request).toBeNull();
  });
});
