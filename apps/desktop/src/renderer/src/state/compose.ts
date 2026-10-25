import type { MessageView, ThreadDetail } from "@flint/core";
import { flint } from "../lib/api";
import { openComposer } from "../features/compose/composerStore";

export type ReplyMode = "reply" | "replyAll" | "forward";

/** The message a reply should answer: the newest one that isn't from the user, else the newest. */
export function replyTarget(messages: MessageView[]): MessageView | undefined {
  return [...messages].reverse().find((m) => !m.isFromMe) ?? messages.at(-1);
}

export function composeFor(message: MessageView, mode: ReplyMode): void {
  openComposer({ mode, messageId: message.id });
}

export async function composeForThread(threadId: number, mode: ReplyMode, thread?: ThreadDetail): Promise<void> {
  const detail = thread ?? (await flint.getThread(threadId));
  const target = replyTarget(detail.messages);
  if (target) composeFor(target, mode);
}
