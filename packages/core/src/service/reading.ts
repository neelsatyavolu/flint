import { z } from "zod";
import type { FlintApi } from "../api";
import { logger } from "../log";
import { FlintError, type MessageRowId, type ThreadId, type ThreadQuery } from "../types";
import { openAttachment, saveAttachment } from "./attachments";
import type { ServiceContext } from "./context";
import { hasOlderOnServer } from "./historyFolders";
import { allowImages } from "./imagePolicy";
import { toMessageView, viewEnv } from "./messageView";

const log = logger("service.reading");

export type ReadingApi = Pick<FlintApi,
  "getSidebar" | "getHome" | "listThreads" | "getThread" | "getMessage" | "allowRemoteImages" | "listFolders" |
  "saveAttachment" | "openAttachment" | "suggestContacts">;

/** How long opening a thread waits for missing bodies before showing what it has. */
export const BODY_WAIT_MS = 1_500;

const id = z.number().int().positive();

export function readingApi(ctx: ServiceContext): ReadingApi {
  const { store } = ctx;
  const syncedFolders = new Set<number>();

  /** First time a user folder is opened its mail is not local yet: pull it, then list. */
  async function syncUserFolderOnce(query: ThreadQuery): Promise<void> {
    if (query.view !== "folder" || query.folderId === undefined) return;
    const folder = store.getFolder(query.folderId);
    if (!folder || folder.role !== null || syncedFolders.has(folder.id)) return;
    if (store.getFolderSyncState(folder.id).lastSyncAt !== null) return;
    syncedFolders.add(folder.id);
    try {
      await ctx.syncs.get(folder.accountId).syncFolderNow(folder.id);
    } catch (error) {
      syncedFolders.delete(folder.id);
      log.warn("could not sync a folder on first open", { folderId: folder.id, reason: (error as Error).message });
    }
  }

  /**
   * The thread with the bodies it has. Missing ones are fetched; the UI waits a moment for quick fetches but never
   * for a slow or dead connection: the rest arrive later and a mail_changed event tells the reader to refresh.
   * Agents get the full bodies (they have no skeleton to show).
   */
  async function loadThread(threadId: ThreadId) {
    const first = store.getThreadRows(threadId);
    if (!first) throw new FlintError("not_found", "That conversation no longer exists.");
    if (!first.messages.some((m) => !m.bodyLoaded)) return first;
    const fetching = ctx.ensureBodies(first.messages.filter((m) => !m.bodyLoaded).map((m) => m.id));
    if (ctx.caller()) {
      await fetching;
    } else {
      let timer: NodeJS.Timeout | undefined;
      const settled = await Promise.race([
        fetching.then(() => true),
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), BODY_WAIT_MS); timer.unref(); }),
      ]);
      clearTimeout(timer);
      if (!settled) {
        void fetching.then(() => ctx.emit({ type: "mail_changed", accountId: first.accountId, threadIds: [threadId] }));
      }
    }
    return store.getThreadRows(threadId) ?? first;
  }

  async function messageView(messageId: MessageRowId) {
    const row = store.getMessage(messageId);
    if (!row) throw new FlintError("not_found", "That message no longer exists.");
    const rows = await loadThread(row.threadId);
    const stored = rows.messages.find((m) => m.id === messageId);
    if (!stored) throw new FlintError("not_found", "That message no longer exists.");
    return toMessageView(viewEnv(store, ctx.getSettings()), stored, stored.flagged);
  }

  return {
    async getSidebar() {
      const data = store.getSidebarData(ctx.now());
      return {
        counts: data.counts,
        accounts: data.accounts.map((a) => ({ ...a, sync: ctx.syncs.status(a.account.id) })),
      };
    },

    async getHome() {
      return store.getHomeData(ctx.now());
    },

    async listThreads(query) {
      await syncUserFolderOnce(query);
      const page = store.listThreads(query, ctx.now());
      return page.nextCursor ? page : { ...page, olderOnServer: hasOlderOnServer(store, query) };
    },

    async getThread(threadId) {
      id.parse(threadId);
      const rows = await loadThread(threadId);
      const env = viewEnv(store, ctx.getSettings());
      return {
        id: rows.id,
        accountId: rows.accountId,
        subject: rows.subject,
        category: rows.category,
        pinned: rows.pinned,
        muted: rows.muted,
        snoozedUntil: rows.snoozedUntil,
        messages: rows.messages.map((m) => toMessageView(env, m)),
        draftIds: rows.draftIds,
      };
    },

    async getMessage(messageId) {
      return messageView(messageId);
    },

    async allowRemoteImages(messageId, always) {
      const row = store.getMessage(messageId);
      if (!row) throw new FlintError("not_found", "That message no longer exists.");
      allowImages(store, messageId, row.from, always);
      ctx.emit({ type: "mail_changed", accountId: row.accountId, threadIds: [row.threadId] });
      return messageView(messageId);
    },

    async listFolders(accountId) {
      store.requireAccount(accountId);
      return store.listFolders(accountId);
    },

    saveAttachment: (attachmentId, path) => saveAttachment(ctx, attachmentId, path),
    openAttachment: (attachmentId) => openAttachment(ctx, attachmentId),

    async suggestContacts(prefix, limit) {
      return store.suggestContacts(prefix, limit);
    },
  };
}
