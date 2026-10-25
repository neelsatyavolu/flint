import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { flint } from "../../lib/api";
import { ToastProvider } from "../../ui/Toast";
import { useComposers, resetComposerStore } from "./composerStore";
import { InlineReplyDock } from "./InlineReplyDock";
import type { InlineReplyMode } from "./inlineReplyTypes";
import { composeFor } from "../../state/compose";
import { navStore } from "../../state/nav";
import { useInlineReply } from "../../state/inlineReply";

// jsdom has no layout; ProseMirror asks for rects when it scrolls a focused selection into view.
const emptyRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
Range.prototype.getClientRects = emptyRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();

let nonce = 0;

async function firstMessage() {
  const list = await flint.listThreads({ view: "inbox" });
  const thread = await flint.getThread(list.items[0]!.id);
  return { thread, message: thread.messages.at(-1)! };
}

function Probe() {
  const open = useComposers();
  return <output data-testid="composers">{open.length}</output>;
}

async function mountDock(mode: InlineReplyMode = "reply", extra: { seedText?: string; draftId?: number } = {}) {
  const { thread, message } = await firstMessage();
  const onClose = vi.fn();
  const view = render(
    <ToastProvider>
      <Probe />
      <InlineReplyDock request={{ threadId: thread.id, messageId: message.id, mode, nonce: ++nonce, ...extra }} onClose={onClose} />
    </ToastProvider>,
  );
  await screen.findByRole("button", { name: "Send" });
  return { onClose, thread, message, view };
}

afterEach(() => {
  resetComposerStore();
  useInlineReply.getState().close();
  navStore.setState({ openId: null });
});

describe("InlineReplyDock", () => {
  it("shows the subject as its title, a To line, the toolbar and a From selector", async () => {
    await mountDock();
    expect(screen.getByRole("heading", { level: 3 }).textContent).toMatch(/^Re: /);
    expect(screen.getByText("To")).toBeTruthy();
    for (const name of ["+AI", "Attach files", "Templates", "Send later", "More", "Open in full composer", "Close and keep draft"]) {
      expect(screen.getByRole("button", { name: new RegExp(name.replace("+", "\\+"), "i") })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: /^Send from / })).toBeTruthy();
  });

  it("sends on Cmd+Enter and reports sent", async () => {
    const { onClose } = await mountDock();
    fireEvent.keyDown(screen.getByRole("region", { name: "Reply" }), { key: "Enter", metaKey: true });
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ draftId: null, reason: "sent" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("sends from the Send button", async () => {
    const { onClose } = await mountDock();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ draftId: null, reason: "sent" }));
  });

  it("keeps a reply that has text when closed with Escape, and reopens it by draft id", async () => {
    const { thread, message } = await firstMessage();
    const draft = await flint.createDraft({ mode: "reply", messageId: message.id });
    await flint.updateDraft(draft.id, { html: "<p>Thanks, see you then.</p>" });
    const { onClose, view } = await mountDock("reply", { draftId: draft.id });
    fireEvent.keyDown(screen.getByRole("region", { name: "Reply" }), { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledWith({ draftId: draft.id, reason: "closed" });
    view.unmount();
    expect((await flint.getThread(thread.id)).draftIds).toContain(draft.id);
  });

  it("deletes an untouched reply when closed", async () => {
    const { thread, message } = await firstMessage();
    const before = (await flint.getThread(thread.id)).draftIds;
    expect(message.threadId).toBe(thread.id);
    const { onClose } = await mountDock();
    fireEvent.click(screen.getByRole("button", { name: /Close and keep draft/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ draftId: null, reason: "closed" }));
    expect((await flint.getThread(thread.id)).draftIds).toEqual(before);
  });

  it("expands into the full composer with the same draft", async () => {
    const { onClose } = await mountDock();
    fireEvent.click(screen.getByRole("button", { name: "Open in full composer" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const result = onClose.mock.calls[0]![0];
    expect(result.reason).toBe("expanded");
    expect(typeof result.draftId).toBe("number");
    expect(screen.getByTestId("composers").textContent).toBe("1");
    expect((await flint.getDraft(result.draftId)).id).toBe(result.draftId);
  });

  it("discards through the More menu", async () => {
    const { onClose } = await mountDock();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Discard draft" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ draftId: null, reason: "discarded" }));
  });

  it("opens forward with an empty To line", async () => {
    await mountDock("forward");
    expect(screen.getByRole("heading", { level: 3 }).textContent).toMatch(/^Fwd: /);
  });
});

describe("reply shortcuts", () => {
  it("dock the reply when the thread is open and fall back to the full composer otherwise", async () => {
    const { message } = await firstMessage();
    composeFor(message, "replyAll");
    expect(useInlineReply.getState().request).toBeNull();

    navStore.setState({ openId: message.threadId });
    composeFor(message, "replyAll");
    expect(useInlineReply.getState().request).toMatchObject({ threadId: message.threadId, messageId: message.id, mode: "replyAll" });
  });

  it("does not restart a reply that is already open for the same message and mode", async () => {
    const { message } = await firstMessage();
    navStore.setState({ openId: message.threadId });
    composeFor(message, "reply");
    const first = useInlineReply.getState().request;
    composeFor(message, "reply");
    expect(useInlineReply.getState().request).toBe(first);
    composeFor(message, "forward");
    expect(useInlineReply.getState().request).not.toBe(first);
  });
});
