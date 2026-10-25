import { buildMime, newMessageId } from "../mail/compose";
import { deleteDraftByUid, replaceDraft } from "../mail/send";
import { logger } from "../log";
import type { ServiceContext } from "./context";
import { draftMimeInput } from "./compose-mime";

const log = logger("service.drafts");

/** SPEC section 3: the server Drafts copy is replaced at most every 10 seconds while a draft is being edited. */
export const SERVER_DRAFT_DELAY_MS = 10_000;

export type ServerDrafts = {
  /** Marks the draft as edited; its server copy is refreshed once the delay passes. */
  touch(draftId: number): void;
  /** Waits for a running upload, cancels a pending one and removes the server copy. Call before deleting the local row. */
  remove(draftId: number): Promise<void>;
  /** Uploads now (tests, shutdown). */
  flush(draftId: number): Promise<void>;
};

export function createServerDrafts(ctx: ServiceContext, delayMs: number = SERVER_DRAFT_DELAY_MS): ServerDrafts {
  const { store } = ctx;
  const timers = new Map<number, NodeJS.Timeout>();
  const running = new Map<number, Promise<void>>();

  const isBlank = (d: { to: unknown[]; cc: unknown[]; bcc: unknown[]; subject: string; html: string; attachments: unknown[] }): boolean =>
    d.to.length + d.cc.length + d.bcc.length + d.attachments.length === 0 && !d.subject.trim() && !d.html.replace(/<[^>]*>/g, "").trim();

  async function upload(draftId: number): Promise<void> {
    const draft = store.getDraft(draftId);
    if (!draft || isBlank(draft)) return;
    const account = store.getAccount(draft.accountId);
    if (!account) return;
    try {
      const folder = store.ensureFolderByRole(account.id, "drafts");
      const meta = store.getDraftMeta(draftId);
      const input = draftMimeInput(store, draft, account, false);
      const mime = await buildMime({ ...input, messageId: newMessageId(draft.from), keepBcc: true, date: new Date(ctx.now()) });
      const uid = await replaceDraft(ctx.syncs.get(account.id), folder.path, meta.serverUid, mime);
      if (store.getDraft(draftId)) store.setDraftMeta(draftId, { serverUid: uid });
      else if (uid !== null) await deleteDraftByUid(ctx.syncs.get(account.id), folder.path, uid);
    } catch (error) {
      log.warn("could not save a draft to the server", { draftId, reason: (error as Error).message });
    }
  }

  function start(draftId: number): Promise<void> {
    const job = upload(draftId).finally(() => { running.delete(draftId); });
    running.set(draftId, job);
    return job;
  }

  return {
    touch(draftId) {
      if (timers.has(draftId)) return;
      const timer = setTimeout(() => {
        timers.delete(draftId);
        const previous = running.get(draftId) ?? Promise.resolve();
        void previous.then(() => start(draftId));
      }, delayMs);
      timer.unref();
      timers.set(draftId, timer);
    },

    async flush(draftId) {
      const timer = timers.get(draftId);
      if (timer) { clearTimeout(timer); timers.delete(draftId); }
      await (running.get(draftId) ?? Promise.resolve());
      await start(draftId);
    },

    async remove(draftId) {
      const timer = timers.get(draftId);
      if (timer) { clearTimeout(timer); timers.delete(draftId); }
      await (running.get(draftId) ?? Promise.resolve());
      const draft = store.getDraft(draftId);
      if (!draft) return;
      const serverUid = store.getDraftMeta(draftId).serverUid;
      if (serverUid === null) return;
      try {
        const folder = store.getFolderByRole(draft.accountId, "drafts");
        if (folder) await deleteDraftByUid(ctx.syncs.get(draft.accountId), folder.path, serverUid);
      } catch (error) {
        log.warn("could not remove a draft from the server", { draftId, reason: (error as Error).message });
      }
    },
  };
}
