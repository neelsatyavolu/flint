import { logger } from "../log";
import { normalizeBlockPattern, senderMatchesBlocked } from "../rules";
import { FlintError, type ThreadId, type ThreadListItem } from "../types";
import type { ServiceContext } from "./context";
import { inverseMove } from "./actionOps";
import { ensureRoleFolders } from "./roleFolders";

const log = logger("service.blocked");
const RESTORE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PAGES = 10;

export function blockedApi(ctx: ServiceContext) {
  const { store } = ctx;

  /** Existing inbox mail from a newly blocked sender goes to Trash, where the Blocked view lists it. */
  async function trashExisting(pattern: string): Promise<void> {
    const ids = store.listThreads({ view: "search", search: `in:inbox from:${pattern}`, limit: 200 }, ctx.now()).items.map((t) => t.id);
    if (ids.length === 0) return;
    try {
      ensureRoleFolders(ctx, ids, "trash");
      await ctx.optimistic.run({
        label: "move blocked mail to Trash",
        local: () => store.moveThreads(ids, { kind: "trash" }),
        server: (actions, locs) => actions.trash(locs),
        inverse: inverseMove(store),
      });
    } catch (error) {
      log.warn("could not move existing mail from a blocked sender", { reason: (error as Error).message });
    }
  }

  /** Trashed threads from this sender in the last 30 days, newest first. */
  function recentlyBlocked(pattern: string): ThreadId[] {
    const only = new Set([pattern]);
    const cutoff = ctx.now() - RESTORE_WINDOW_MS;
    const ids: ThreadId[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = store.listThreads({ view: "blocked", limit: 200, ...(cursor ? { cursor } : {}) }, ctx.now());
      const fresh = result.items.filter((t: ThreadListItem) => t.lastDate >= cutoff);
      ids.push(...fresh.filter((t) => t.participants.some((p) => senderMatchesBlocked(p.address, only))).map((t) => t.id));
      if (!result.nextCursor || fresh.length < result.items.length) break;
      cursor = result.nextCursor;
    }
    return ids;
  }

  return {
    async blockSender(input: string): Promise<void> {
      const pattern = store.blockSender(input);
      await trashExisting(pattern);
      for (const a of store.listAccounts()) ctx.emit({ type: "mail_changed", accountId: a.id, threadIds: [] });
    },

    async unblockSender(input: string): Promise<void> {
      const pattern = normalizeBlockPattern(input);
      if (!pattern) throw new FlintError("invalid", "Enter an email address or a domain.");
      const restore = recentlyBlocked(pattern);
      store.unblockSender(pattern);
      if (restore.length > 0) {
        await ctx.optimistic.run({
          label: "move mail back to the inbox",
          local: () => store.moveThreads(restore, { kind: "inbox" }),
          server: (actions, locs) => actions.moveToInbox(locs),
          inverse: inverseMove(store),
        });
      }
      for (const a of store.listAccounts()) ctx.emit({ type: "mail_changed", accountId: a.id, threadIds: [] });
    },

    async listBlocked() {
      return store.listBlocked();
    },
  };
}
