import { z } from "zod";
import type { FlintApi } from "../api";
import { inverseFlagged, inverseMove, inverseSeen } from "./actionOps";
import { blockedApi } from "./blocked";
import type { ServiceContext } from "./context";
import { ensureRoleFolders } from "./roleFolders";
import { unsubscribe } from "./unsubscribe";

export type ActionsApi = Pick<FlintApi,
  "markRead" | "setPinned" | "archive" | "trash" | "markSpam" | "moveToFolder" | "moveToInbox" | "snooze" | "unsnooze" |
  "setMuted" | "undo" | "unsubscribe" | "blockSender" | "unblockSender" | "listBlocked">;

const threadIds = z.array(z.number().int().positive()).max(5000);

export function actionsApi(ctx: ServiceContext): ActionsApi {
  const { store } = ctx;
  const run = ctx.optimistic.run;
  const move = inverseMove(store);

  return {
    async markRead(ids, read) {
      const t = threadIds.parse(ids);
      return run({ label: read ? "mark as read" : "mark as unread", local: () => store.markRead(t, read), server: (a, l) => a.setSeen(l, read), inverse: inverseSeen });
    },

    async setPinned(ids, pinned) {
      const t = threadIds.parse(ids);
      return run({ label: pinned ? "pin" : "unpin", local: () => store.setPinned(t, pinned), server: (a, l) => a.setFlagged(l, pinned), inverse: inverseFlagged });
    },

    async archive(ids) {
      const t = threadIds.parse(ids);
      return run({ label: "archive", local: () => store.moveThreads(t, { kind: "archive" }), server: (a, l) => a.archive(l), inverse: move });
    },

    async trash(ids) {
      const t = threadIds.parse(ids);
      ensureRoleFolders(ctx, t, "trash");
      return run({ label: "move to Trash", local: () => store.moveThreads(t, { kind: "trash" }), server: (a, l) => a.trash(l), inverse: move });
    },

    async markSpam(ids, spam) {
      const t = threadIds.parse(ids);
      if (spam) ensureRoleFolders(ctx, t, "spam");
      return run(spam
        ? { label: "mark as spam", local: () => store.moveThreads(t, { kind: "spam" }), server: (a, l) => a.spam(l), inverse: move }
        : { label: "mark as not spam", local: () => store.moveThreads(t, { kind: "inbox" }), server: (a, l) => a.unspam(l), inverse: move });
    },

    async moveToFolder(ids, folderId) {
      const t = threadIds.parse(ids);
      return run({ label: "move", local: () => store.moveThreads(t, { kind: "folder", folderId }), server: (a, l) => a.moveToFolder(l, folderId), inverse: move });
    },

    async moveToInbox(ids) {
      const t = threadIds.parse(ids);
      return run({ label: "move to the inbox", local: () => store.moveThreads(t, { kind: "inbox" }), server: (a, l) => a.moveToInbox(l), inverse: move });
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
      await ctx.optimistic.undo(token);
      ctx.scheduler.poke();
    },

    unsubscribe: (messageId) => unsubscribe(ctx, messageId),
    ...blockedApi(ctx),
  };
}
