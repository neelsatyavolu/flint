import type { AccountId, Bundle, FlintApi, ThreadId, ThreadListItem } from "@flint/core";
import { flint } from "../../lib/api";
import { listStore } from "../../state/listStore";
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

export type Notify = (t: { message: string; level?: "info" | "error"; action?: { label: string; onClick: () => void }; timeout?: number; onDismiss?: () => void }) => void;

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

/** How long the toast offering Undo for a deleted draft stays up (longer while hovered or focused). */
export const DRAFT_UNDO_MS = 5000;

type DraftBatch = { draftIds: number[]; rowIds: ThreadId[]; notify: Notify };
/** Deletes asked for in the current tick, shown as one toast. */
let gathering: DraftBatch | null = null;
/** Deletes whose Undo toast is still up. */
const pending = new Set<DraftBatch>();
let flushHooked = false;

/**
 * Deletes the local draft behind a Drafts-view row (and its server copy). The row leaves at once, but the delete
 * runs only once the "Undo" toast goes away, so a slip of the # key loses nothing. Calls in the same tick
 * (several selected drafts) share one toast.
 */
export async function deleteDraftRow(draftId: number, notify: Notify): Promise<void> {
  const row = listStore.getState().raw.find((i) => i.draft?.draftId === draftId);
  if (row) listStore.getState().hide([row.id]);
  if (gathering === null) {
    gathering = { draftIds: [], rowIds: [], notify };
    queueMicrotask(() => {
      const batch = gathering;
      gathering = null;
      if (batch) scheduleDraftDelete(batch);
    });
  }
  gathering = { ...gathering, draftIds: [...gathering.draftIds, draftId], rowIds: row ? [...gathering.rowIds, row.id] : gathering.rowIds };
}

/** Runs every delete still waiting on its Undo toast. */
export function flushDraftDeletes(): void {
  for (const batch of [...pending]) void commitDraftDelete(batch);
}

/**
 * Commits waiting deletes when the page goes away, and when the list changes: another list drops the hidden rows,
 * so a waiting draft would show again and could be opened.
 */
function hookFlush(): void {
  if (flushHooked || typeof window === "undefined") return;
  flushHooked = true;
  window.addEventListener("pagehide", flushDraftDeletes);
  window.addEventListener("beforeunload", flushDraftDeletes);
  listStore.subscribe((s, prev) => {
    if (s.queryKey !== prev.queryKey) flushDraftDeletes();
  });
}

function scheduleDraftDelete(batch: DraftBatch): void {
  hookFlush();
  pending.add(batch);
  // Cmd+Z replays the last thread action; a draft delete is not one, so it must not undo something older instead.
  navStore.getState().setLastUndo(null);
  const count = batch.draftIds.length;
  batch.notify({
    message: count === 1 ? "Draft deleted" : `Deleted ${count} drafts`,
    timeout: DRAFT_UNDO_MS,
    onDismiss: () => void commitDraftDelete(batch),
    action: {
      label: "Undo",
      onClick: () => {
        if (!pending.delete(batch)) {
          batch.notify({ message: count === 1 ? "Too late to undo. The draft is already deleted." : "Too late to undo. The drafts are already deleted.", level: "error" });
          return;
        }
        listStore.getState().unhide(batch.rowIds);
      },
    },
  });
}

async function commitDraftDelete(batch: DraftBatch): Promise<void> {
  if (!pending.delete(batch)) return;
  const results = await Promise.allSettled(batch.draftIds.map((id) => flint.deleteDraft(id)));
  const failed = batch.draftIds.filter((_, i) => results[i]?.status === "rejected");
  const back = new Set(failed);
  const failedRows = listStore.getState().raw.filter((i) => i.draft?.draftId != null && back.has(i.draft.draftId)).map((i) => i.id);
  if (failed.length) {
    listStore.getState().unhide(failedRows);
    batch.notify({ message: failed.length === 1 ? "Couldn't delete the draft. Try again." : `Couldn't delete ${failed.length} drafts. Try again.`, level: "error" });
  }
  if (failed.length === batch.draftIds.length) return;
  await listStore.getState().refresh();
  listStore.getState().unhide(batch.rowIds);
}

/** Selects every conversation loaded in the list. Bundle rows are not conversations and stay out. */
export function selectAll(): void {
  const ids = listStore.getState().entries.flatMap((e) => (e.kind === "thread" ? [e.item.id] : []));
  navStore.getState().setSelected(ids);
}

/** Bundles above this many conversations ask before "Mark all as read" or "Archive all". */
export const BUNDLE_CONFIRM_OVER = 50;
const BUNDLE_PAGE = 200;

/** Every conversation in a bundle (only the unread ones when `unreadOnly`), read 200 at a time. */
export async function bundleThreadIds(
  category: Bundle["category"],
  accountId: AccountId | undefined,
  unreadOnly: boolean,
  api: Pick<FlintApi, "listThreads"> = flint,
): Promise<ThreadId[]> {
  let ids: ThreadId[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.listThreads({ view: "inbox", category, accountId, limit: BUNDLE_PAGE, ...(unreadOnly ? { unreadOnly: true } : {}), ...(cursor ? { cursor } : {}) });
    ids = [...ids, ...page.items.map((i) => i.id)];
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return ids;
}
