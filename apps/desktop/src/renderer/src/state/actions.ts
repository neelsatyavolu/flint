import type { Bundle, Category, FlintApi, FolderId, Settings, ThreadId, ThreadListItem } from "@flint/core";
import { formatPresetTime } from "../lib/time";
import type { ListStore } from "./listStore";
import type { NavStore, NavView } from "./nav";
import { threadKey } from "./grouping";
import { CATEGORY_TITLES } from "./viewMeta";

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
  | { type: "inbox" }
  /** Files the conversations under People, Notifications or Newsletters. `sender` also remembers it for their senders. */
  | { type: "category"; category: Category; sender?: boolean };

type ToastButton = { label: string; onClick: () => void };
export type NotifyInput = { message: string; action?: ToastButton; secondaryAction?: ToastButton; level?: "info" | "error" };

export type ActionDeps = {
  api: Pick<FlintApi, "archive" | "trash" | "markSpam" | "setPinned" | "markRead" | "setMuted" | "setCategory" | "snooze" | "unsnooze" | "moveToFolder" | "moveToInbox" | "undo">;
  list: ListStore;
  nav: NavStore;
  notify: (t: NotifyInput) => void;
  getSettings: () => Settings | undefined;
  now?: () => number;
};

type ViewInfo = {
  view: NavView;
  folderId?: FolderId;
  /** The category list that is open (the inbox filtered to one category). */
  category?: Category;
  /** The inbox shows only People plus bundle rows. */
  focused?: boolean;
};

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
    case "category":
      if (v.view !== "inbox") return false;
      return v.category ? v.category !== action.category : v.focused !== false && action.category !== "people";
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
    case "category":
      return action.sender
        ? `Mail from ${count === 1 ? "this sender" : "these senders"} will go to ${CATEGORY_TITLES[action.category]}`
        : `Moved${noun} to ${CATEGORY_TITLES[action.category]}`;
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
  category: "Couldn't change the category. Try again.",
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
    case "category": return api.setCategory(ids, action.category, action.sender ? { sender: true } : undefined);
  }
}

const isMe = (p: { name: string }) => p.name.trim().toLowerCase() === "me";

/** Who the "Always for ..." button names: the one sender of these rows, or a plural when they differ. */
export function senderLabel(items: ThreadListItem[]): string | null {
  const senders = new Map<string, string>();
  for (const i of items) {
    const p = i.participants.find((x) => !isMe(x));
    if (p) senders.set(p.address.toLowerCase(), p.name.trim() || p.address);
  }
  if (senders.size === 0) return null;
  return senders.size === 1 ? [...senders.values()][0]! : "these senders";
}

/** Bundle rows as they will read once these People rows are filed under `category`. */
function withMoved(bundles: Bundle[], category: Exclude<Category, "people">, moved: ThreadListItem[]): Bundle[] {
  const unread = moved.filter((i) => i.unreadCount > 0).length;
  const lastDate = Math.max(...moved.map((i) => i.lastDate));
  const latest = moved.map((i) => ({ from: i.participants.find((p) => !isMe(p)) ?? i.participants[0]!, subject: i.subject }));
  const have = bundles.find((b) => b.category === category);
  if (!have) return [...bundles, { category, unreadCount: unread, totalCount: moved.length, lastDate, latest: latest.slice(0, 3) }];
  return bundles.map((b) => (b === have
    ? { ...b, unreadCount: b.unreadCount + unread, totalCount: b.totalCount + moved.length, lastDate: Math.max(b.lastDate, lastDate), latest: [...latest, ...b.latest].slice(0, 3) }
    : b));
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
 * The core answers once its local change is made; a later server refusal comes back as a toast and a mail_changed.
 */
export async function performAction(deps: ActionDeps, action: ThreadAction, allIds: ThreadId[]): Promise<void> {
  // Local-only draft rows carry negative ids; they are not threads, so thread actions skip them (they only support delete).
  const ids = allIds.filter((id) => id > 0);
  if (ids.length === 0) return;
  const { api, list, nav, notify } = deps;
  const before = list.getState();
  const navState = nav.getState();
  const removes = removesFromView(action, { view: navState.view, folderId: navState.folderId, category: navState.category, focused: deps.getSettings()?.inbox.focused ?? true });
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
    if (action.type === "category" && action.category !== "people" && !navState.category) {
      const moved = [...originals.values()].filter((i) => i.category === "people");
      if (moved.length > 0) list.getState().patchBundles((b) => withMoved(b, action.category as Exclude<Category, "people">, moved));
    }
  } else if (patch) {
    list.getState().patchItems(ids, patch);
  }

  try {
    const { undoToken } = await call(api, action, ids);
    nav.getState().setLastUndo(undoToken);
    const message = actionMessage(action, ids.length, deps.now?.());
    if (message) {
      const sender = action.type === "category" && !action.sender ? senderLabel([...originals.values()]) : null;
      notify({
        message,
        action: {
          label: "Undo",
          onClick: () => {
            // Spent here, so a later ⌘Z doesn't try the same token again.
            if (nav.getState().lastUndoToken === undoToken) nav.getState().setLastUndo(null);
            void api.undo(undoToken).then(() => list.getState().refresh(), () => notify({ message: "Too late to undo that.", level: "error" }));
          },
        },
        ...(sender && action.type === "category" ? {
          secondaryAction: {
            label: `Always for ${sender}`,
            onClick: () => void performAction(deps, { type: "category", category: action.category, sender: true }, ids),
          },
        } : {}),
      });
    }
    // The action's mail_changed refreshes the list; the rows stay hidden until that lands so they don't flash back.
    if (removes) unhideAfterReload(list, ids);
  } catch {
    if (!removes && patch) list.getState().patchItems(ids, (i) => originals.get(i.id) ?? i);
    if (removes) list.getState().unhide(ids);
    notify({ message: FAILURE[action.type], level: "error" });
  }
}

/** Longest a removed row stays hidden while waiting for the list to reload. */
const UNHIDE_FALLBACK_MS = 3000;

/** Unhides `ids` once the list's rows next change (a refresh landed), or after a fallback delay. */
function unhideAfterReload(list: ListStore, ids: ThreadId[]): void {
  const raw = list.getState().raw;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = () => {
    off();
    clearTimeout(timer);
    list.getState().unhide(ids);
  };
  const off = list.subscribe((s) => {
    if (s.raw !== raw) done();
  });
  timer = setTimeout(done, UNHIDE_FALLBACK_MS);
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
