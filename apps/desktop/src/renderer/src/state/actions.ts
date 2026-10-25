import type { FlintApi, FolderId, Settings, ThreadId, ThreadListItem } from "@flint/core";
import { formatPresetTime } from "../lib/time";
import type { ListStore } from "./listStore";
import type { NavStore, NavView } from "./nav";
import { threadKey } from "./grouping";

export type ThreadAction =
  | { type: "archive" }
  | { type: "trash" }
  | { type: "spam"; spam: boolean }
  | { type: "pin"; pinned: boolean }
  | { type: "read"; read: boolean }
  | { type: "mute"; muted: boolean }
  | { type: "snooze"; until: number }
  | { type: "unsnooze" }
  | { type: "move"; folderId: FolderId; folderName: string }
  | { type: "inbox" };

export type NotifyInput = { message: string; action?: { label: string; onClick: () => void }; level?: "info" | "error" };

export type ActionDeps = {
  api: Pick<FlintApi, "archive" | "trash" | "markSpam" | "setPinned" | "markRead" | "setMuted" | "snooze" | "unsnooze" | "moveToFolder" | "moveToInbox" | "undo">;
  list: ListStore;
  nav: NavStore;
  notify: (t: NotifyInput) => void;
  getSettings: () => Settings | undefined;
  now?: () => number;
};

type ViewInfo = { view: NavView; folderId?: FolderId };

/** Whether the thread leaves the list the user is looking at once the action is applied. */
export function removesFromView(action: ThreadAction, v: ViewInfo): boolean {
  switch (action.type) {
    case "archive":
      return ["inbox", "snoozed", "trash", "spam", "blocked"].includes(v.view);
    case "trash":
      return v.view !== "trash";
    case "spam":
      return action.spam ? v.view !== "spam" : v.view === "spam";
    case "pin":
      return !action.pinned && v.view === "pinned";
    case "snooze":
      return v.view === "inbox";
    case "unsnooze":
      return v.view === "snoozed";
    case "move":
      if (v.view === "folder") return v.folderId !== action.folderId;
      return ["inbox", "snoozed", "trash", "spam", "blocked", "archive"].includes(v.view);
    case "inbox":
      return ["archive", "trash", "spam", "blocked", "folder"].includes(v.view);
    case "read":
    case "mute":
      return false;
  }
}

export function actionMessage(action: ThreadAction, count: number, now: number = Date.now()): string | null {
  const noun = count === 1 ? "" : ` ${count} conversations`;
  switch (action.type) {
    case "archive": return `Archived${noun}`;
    case "trash": return count === 1 ? "Moved to Trash" : `Moved${noun} to Trash`;
    case "spam": return action.spam ? (count === 1 ? "Marked as spam" : `Marked${noun} as spam`) : "Not spam";
    case "mute": return action.muted ? "Muted" : "Unmuted";
    case "snooze": return `Snoozed until ${formatPresetTime(action.until, now)}`;
    case "unsnooze": return "Snooze removed";
    case "move": return `Moved to ${action.folderName}`;
    case "inbox": return "Moved to Inbox";
    case "pin":
    case "read":
      return null;
  }
}

const FAILURE: Record<ThreadAction["type"], string> = {
  archive: "Couldn't archive. Try again.",
  trash: "Couldn't move to Trash. Try again.",
  spam: "Couldn't update spam. Try again.",
  pin: "Couldn't change the pin. Try again.",
  read: "Couldn't change read state. Try again.",
  mute: "Couldn't change mute. Try again.",
  snooze: "Couldn't snooze. Try again.",
  unsnooze: "Couldn't remove the snooze. Try again.",
  move: "Couldn't move. Try again.",
  inbox: "Couldn't move to Inbox. Try again.",
};

function optimisticPatch(action: ThreadAction): ((item: ThreadListItem) => Partial<ThreadListItem>) | null {
  switch (action.type) {
    case "pin": return () => ({ pinned: action.pinned });
    case "read": return (i) => ({ unreadCount: action.read ? 0 : Math.max(1, i.unreadCount) });
    case "mute": return () => ({ muted: action.muted });
    default: return null;
  }
}

function call(api: ActionDeps["api"], action: ThreadAction, ids: ThreadId[]): Promise<{ undoToken: string }> {
  switch (action.type) {
    case "archive": return api.archive(ids);
    case "trash": return api.trash(ids);
    case "spam": return api.markSpam(ids, action.spam);
    case "pin": return api.setPinned(ids, action.pinned);
    case "read": return api.markRead(ids, action.read);
    case "mute": return api.setMuted(ids, action.muted);
    case "snooze": return api.snooze(ids, action.until);
    case "unsnooze": return api.unsnooze(ids);
    case "move": return api.moveToFolder(ids, action.folderId);
    case "inbox": return api.moveToInbox(ids);
  }
}

/** Which thread to open after `gone` leave the list, per settings.inbox.afterArchive. */
export function pickAdvance(items: ThreadListItem[], openId: ThreadId, gone: ThreadId[], mode: Settings["inbox"]["afterArchive"]): ThreadId | null {
  if (mode === "list") return null;
  const away = new Set(gone);
  const at = items.findIndex((i) => i.id === openId);
  if (at === -1) return null;
  const next = items.slice(at + 1).find((i) => !away.has(i.id))?.id ?? null;
  const prev = [...items.slice(0, at)].reverse().find((i) => !away.has(i.id))?.id ?? null;
  return mode === "previous" ? prev ?? next : next ?? prev;
}

/**
 * Applies an action optimistically: the row leaves (or changes) at once, the API call runs,
 * and a failure puts everything back. Success shows an "Undo" toast that calls api.undo.
 */
export async function performAction(deps: ActionDeps, action: ThreadAction, allIds: ThreadId[]): Promise<void> {
  // Local-only draft rows carry negative ids; they are not threads, so thread actions skip them (they only support delete).
  const ids = allIds.filter((id) => id > 0);
  if (ids.length === 0) return;
  const { api, list, nav, notify } = deps;
  const before = list.getState();
  const navState = nav.getState();
  const removes = removesFromView(action, { view: navState.view, folderId: navState.folderId });
  const originals = new Map(before.raw.filter((i) => ids.includes(i.id)).map((i) => [i.id, i]));
  const patch = optimisticPatch(action);

  if (removes) {
    const open = navState.openId;
    if (open !== null && ids.includes(open)) {
      const mode = deps.getSettings()?.inbox.afterArchive ?? "next";
      const next = pickAdvance(before.items, open, ids, mode);
      nav.getState().openThread(next);
      if (next === null) nav.getState().setCursor(null);
    } else if (navState.cursorKey && ids.some((id) => threadKey(id) === navState.cursorKey)) {
      nav.getState().setCursor(null);
    }
    if (navState.selected.length) nav.getState().setSelected(navState.selected.filter((id) => !ids.includes(id)));
    list.getState().hide(ids);
  } else if (patch) {
    list.getState().patchItems(ids, patch);
  }

  try {
    const { undoToken } = await call(api, action, ids);
    nav.getState().setLastUndo(undoToken);
    const message = actionMessage(action, ids.length, deps.now?.());
    if (message) {
      notify({
        message,
        action: {
          label: "Undo",
          onClick: () => {
            void api.undo(undoToken).then(() => list.getState().refresh(), () => notify({ message: "Too late to undo that.", level: "error" }));
          },
        },
      });
    }
    await list.getState().refresh();
  } catch {
    if (!removes && patch) list.getState().patchItems(ids, (i) => originals.get(i.id) ?? i);
    notify({ message: FAILURE[action.type], level: "error" });
  } finally {
    if (removes) list.getState().unhide(ids);
  }
}

/** Runs the last undo token, if any. */
export async function undoLast(deps: Pick<ActionDeps, "api" | "list" | "nav" | "notify">): Promise<void> {
  const token = deps.nav.getState().lastUndoToken;
  if (!token) return;
  deps.nav.getState().setLastUndo(null);
  try {
    await deps.api.undo(token);
    await deps.list.getState().refresh();
    deps.notify({ message: "Undone" });
  } catch {
    deps.notify({ message: "Too late to undo that.", level: "error" });
  }
}
