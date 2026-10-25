import type { ThreadListItem } from "@flint/core";
import { flint } from "../../lib/api";
import { openComposer } from "../compose/composerStore";
import { composeForThread, type ReplyMode } from "../../state/compose";
import { navStore } from "../../state/nav";

export function openSnooze(ids: number[]): void {
  if (ids.length) navStore.getState().showOverlay("snooze", ids);
}

export function openMovePicker(ids: number[]): void {
  if (ids.length) navStore.getState().showOverlay("move", ids);
}

export function compose(): void {
  openComposer({ mode: "new" });
}

export function replyTo(threadId: number, mode: ReplyMode): void {
  void composeForThread(threadId, mode);
}

/** Opens the draft behind a Drafts-view row in the composer. */
export async function openDraftThread(threadId: number): Promise<void> {
  const thread = await flint.getThread(threadId);
  const draftId = thread.draftIds[0];
  if (draftId !== undefined) openComposer({ draftId });
}

export type Notify = (t: { message: string; level?: "info" | "error" }) => void;

/**
 * Opens the draft behind a Drafts-view row. A local draft opens straight away; a server draft with no local copy
 * first becomes one (openServerDraft), so the next save replaces the server copy.
 */
export async function openDraftRow(item: ThreadListItem, notify: Notify): Promise<void> {
  try {
    const ref = item.draft;
    if (ref?.draftId != null) {
      openComposer({ draftId: ref.draftId });
    } else if (ref?.messageId != null) {
      const draft = await flint.openServerDraft(ref.messageId);
      openComposer({ draftId: draft.id });
    } else {
      await openDraftThread(item.id);
    }
  } catch {
    notify({ message: "Couldn't open the draft. Try again.", level: "error" });
  }
}

/** Deletes the local draft behind a Drafts-view row (and its server copy). */
export async function deleteDraftRow(draftId: number, notify: Notify): Promise<void> {
  try {
    await flint.deleteDraft(draftId);
    notify({ message: "Draft deleted" });
  } catch {
    notify({ message: "Couldn't delete the draft. Try again.", level: "error" });
  }
}
