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
