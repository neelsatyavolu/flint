import type { MessageView, ThreadDetail } from "@flint/core";
import { flint } from "../lib/api";
import { openComposer } from "../features/compose/composerStore";
import { FOCUS_REPLY_EVENT } from "../features/compose/inlineReplyTypes";
import { navStore } from "./nav";
import { useInlineReply } from "./inlineReply";

export type ReplyMode = "reply" | "replyAll" | "forward";

/** The message a reply should answer: the newest one that isn't from the user, else the newest. */
export function replyTarget(messages: MessageView[]): MessageView | undefined {
  return [...messages].reverse().find((m) => !m.isFromMe) ?? messages.at(-1);
}

/**
 * Answers a message. When its thread is open in the reader the reply docks at the bottom of the thread;
 * otherwise (a thread that isn't open, for example from the palette) it opens in the full composer.
 */
export function composeFor(message: MessageView, mode: ReplyMode): void {
  if (navStore.getState().openId !== message.threadId) {
    openComposer({ mode, messageId: message.id });
    return;
  }
  const current = useInlineReply.getState().request;
  if (current && current.threadId === message.threadId && current.messageId === message.id && current.mode === mode && current.draftId === undefined) {
    window.dispatchEvent(new Event(FOCUS_REPLY_EVENT));
    return;
  }
  useInlineReply.getState().open({ threadId: message.threadId, messageId: message.id, mode });
}

export async function composeForThread(threadId: number, mode: ReplyMode, thread?: ThreadDetail): Promise<void> {
  const detail = thread ?? (await flint.getThread(threadId));
  const target = replyTarget(detail.messages);
  if (target) composeFor(target, mode);
}
