import { z } from "zod";
import type { FlintApi } from "../api";
import { inverseFlagged, inverseMove, inverseSeen } from "./actionOps";
import { blockedApi } from "./blocked";
import { categoriesApi } from "./categories";
import type { ServiceContext } from "./context";
import { ensureRoleFolders } from "./roleFolders";
import { unsubscribe } from "./unsubscribe";

export type ActionsApi = Pick<FlintApi,
  "markRead" | "setPinned" | "archive" | "trash" | "markSpam" | "moveToFolder" | "moveToInbox" | "snooze" | "unsnooze" |
  "setMuted" | "setCategory" | "undo" | "unsubscribe" | "blockSender" | "unblockSender" | "listBlocked">;

const threadIds = z.array(z.number().int().positive()).max(5000);

export function actionsApi(ctx: ServiceContext): ActionsApi {
  const { store } = ctx;
  const run = ctx.optimistic.run;
  const move = inverseMove(store);
  const categories = categoriesApi(ctx);

  return {
    async markRead(ids, read) {
      const t = threadIds.parse(ids);
      return run({ label: read ? "mark as read" : "mark as unread", local: () => store.markRead(t, read), server: (a, l) => a.setSeen(l, read), op: { kind: "seen", arg: read }, inverse: inverseSeen });
    },

    async setPinned(ids, pinned) {
      const t = threadIds.parse(ids);
      return run({ label: pinned ? "pin" : "unpin", local: () => store.setPinned(t, pinned), server: (a, l) => a.setFlagged(l, pinned), op: { kind: "flagged", arg: pinned }, inverse: inverseFlagged });
    },

    async archive(ids) {
      const t = threadIds.parse(ids);
      return run({ label: "archive", local: () => store.moveThreads(t, { kind: "archive" }), server: (a, l) => a.archive(l), op: { kind: "archive" }, inverse: move });
    },

    async trash(ids) {
      const t = threadIds.parse(ids);
      ensureRoleFolders(ctx, t, "trash");
      return run({ label: "move to Trash", local: () => store.moveThreads(t, { kind: "trash" }), server: (a, l) => a.trash(l), op: { kind: "trash" }, inverse: move });
    },

    async markSpam(ids, spam) {
      const t = threadIds.parse(ids);
      if (spam) ensureRoleFolders(ctx, t, "spam");
      return run(spam
        ? { label: "mark as spam", local: () => store.moveThreads(t, { kind: "spam" }), server: (a, l) => a.spam(l), op: { kind: "spam" }, inverse: move }
        : { label: "mark as not spam", local: () => store.moveThreads(t, { kind: "inbox" }), server: (a, l) => a.unspam(l), op: { kind: "unspam" }, inverse: move });
    },

    async moveToFolder(ids, folderId) {
      const t = threadIds.parse(ids);
      return run({ label: "move", local: () => store.moveThreads(t, { kind: "folder", folderId }), server: (a, l) => a.moveToFolder(l, folderId), op: { kind: "move_folder", arg: folderId }, inverse: move });
    },

    async moveToInbox(ids) {
      const t = threadIds.parse(ids);
      return run({ label: "move to the inbox", local: () => store.moveThreads(t, { kind: "inbox" }), server: (a, l) => a.moveToInbox(l), op: { kind: "move_inbox" }, inverse: move });
    },

    async snooze(ids, until) {
      const t = threadIds.parse(ids);
      const out = await run({ label: "snooze", local: () => store.snooze(t, z.number().int().positive().parse(until)) });
      ctx.scheduler.poke();
      return out;
    },

    async unsnooze(ids) {
      const t = threadIds.parse(ids);
      const out = await run({ label: "unsnooze", local: () => store.unsnooze(t) });
      ctx.scheduler.poke();
      return out;
    },

    async setMuted(ids, muted) {
      const t = threadIds.parse(ids);
      return run({ label: muted ? "mute" : "unmute", local: () => store.setMuted(t, muted) });
    },

    async undo(token) {
      try {
        await ctx.optimistic.undo(token);
      } catch (err) {
        categories.forget(token);
        throw err;
      }
      categories.onUndo(token);
      ctx.scheduler.poke();
    },

    setCategory: categories.api.setCategory,

    unsubscribe: (messageId) => unsubscribe(ctx, messageId),
    ...blockedApi(ctx),
  };
}
