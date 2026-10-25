import { sanitizeForDisplay } from "../sanitize";
import type { Store } from "../store";
import type { StoredThreadMessage } from "../store/types";
import type { MessageView, Settings } from "../types";
import { imagePolicy, type ImagePolicy } from "./imagePolicy";

/**
 * Inline (cid:) images are rewritten to this scheme: `flint-attachment://<attachmentId>`.
 * The desktop main process serves it by reading the attachment through saveAttachment/fetchAttachment.
 */
export const ATTACHMENT_URL_PREFIX = "flint-attachment://";

export function receiptsHostOf(endpoint: string): string | undefined {
  if (!endpoint.trim()) return undefined;
  try {
    return new URL(/^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`).host;
  } catch {
    return undefined;
  }
}

export type ViewEnv = { store: Store; settings: Settings; policy: ImagePolicy; receiptsHost: string | undefined };

export function viewEnv(store: Store, settings: Settings): ViewEnv {
  return { store, settings, policy: imagePolicy(store, settings), receiptsHost: receiptsHostOf(settings.receipts.endpoint) };
}

const stripCid = (cid: string): string => cid.replace(/^<|>$/g, "").toLowerCase();

/** Builds the renderer's MessageView: sanitized HTML with the image policy applied, trackers removed, receipt attached. */
export function toMessageView(env: ViewEnv, m: StoredThreadMessage, pinned = m.flagged): MessageView {
  const allow = env.policy.allowed(m.id, m.from, m.isFromMe);
  const cids = new Map(m.attachments.filter((a) => a.contentId).map((a) => [stripCid(a.contentId!), a.id]));
  const clean = m.rawHtml
    ? sanitizeForDisplay(m.rawHtml, {
      allowRemoteImages: allow,
      blockTrackers: env.settings.inbox.blockTrackers,
      ...(env.receiptsHost ? { receiptsHost: env.receiptsHost } : {}),
      cidResolver: (cid) => {
        const id = cids.get(stripCid(cid));
        return id === undefined ? null : `${ATTACHMENT_URL_PREFIX}${id}`;
      },
    })
    : null;
  return {
    id: m.id,
    accountId: m.accountId,
    threadId: m.threadId,
    messageId: m.messageId,
    from: m.from, to: m.to, cc: m.cc, bcc: m.bcc, replyTo: m.replyTo,
    subject: m.subject,
    date: m.date,
    seen: m.seen,
    pinned,
    isFromMe: m.isFromMe,
    snippet: m.snippet,
    html: clean?.html ?? null,
    text: m.text,
    bodyLoaded: m.bodyLoaded,
    remoteImages: allow || !clean?.hasRemoteImages ? "allowed" : "blocked",
    hasTrackers: clean?.hasTrackers ?? false,
    attachments: m.attachments,
    unsubscribe: m.unsubscribe,
    receipt: m.messageId ? env.store.getReceiptDetailForMessage(m.accountId, m.messageId) : null,
  };
}
