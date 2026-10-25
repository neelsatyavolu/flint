import { create } from "zustand";
import type { InlineReplyMode, InlineReplyRequest } from "../features/compose/inlineReplyTypes";

type State = {
  /** The reply the reader's dock should show, or null. The reader renders InlineReplyDock for it when its threadId is open. */
  request: InlineReplyRequest | null;
  open: (req: Omit<InlineReplyRequest, "nonce">) => void;
  close: () => void;
  /** The draft the open dock is editing, so the reader doesn't also list it as a draft card. */
  liveDraftId: number | null;
  setLiveDraft: (id: number | null) => void;
};

let nonce = 0;

/** Shared by the card buttons, the R / A / F shortcuts, the toolbar and draft cards. The reply area owns who calls open(). */
export const useInlineReply = create<State>((set) => ({
  request: null,
  open: (req) => set({ request: { ...req, nonce: ++nonce } }),
  close: () => set({ request: null }),
  liveDraftId: null,
  setLiveDraft: (liveDraftId) => set({ liveDraftId }),
}));

export type { InlineReplyMode };
