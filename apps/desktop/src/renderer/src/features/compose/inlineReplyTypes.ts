// FROZEN contract between the thread area (mounts the dock in the reader) and the reply area (implements it).

export type InlineReplyMode = "reply" | "replyAll" | "forward";

/** What to open. A new `nonce` re-opens the dock even for the same message and mode (for example after Esc). */
export type InlineReplyRequest = {
  threadId: number;
  /** The message being answered or forwarded. */
  messageId: number;
  mode: InlineReplyMode;
  /** Quick-reply text to start the body with. */
  seedText?: string;
  /** Re-open a kept draft (the Edit button on a draft card) instead of creating a new one. */
  draftId?: number;
  nonce: number;
};

export type InlineReplyCloseResult = {
  /** The draft left behind, if any. When set the thread shows it as a draft card. */
  draftId: number | null;
  reason: "closed" | "sent" | "discarded" | "expanded";
};

export type InlineReplyDockProps = {
  request: InlineReplyRequest;
  /** Called once when the dock goes away. The reader refetches the thread so draft cards and the sent message appear. */
  onClose: (result: InlineReplyCloseResult) => void;
};

/** Fired when R / A / F is pressed for the message the dock is already answering: focus the body instead of starting over. */
export const FOCUS_REPLY_EVENT = "flint:focus-reply";
