import { randomBytes } from "node:crypto";
import MailComposer, { type MailComposerAttachment as Attachment, type MailComposerOptions as MailOptions } from "nodemailer/lib/mail-composer";
import { sanitizeForDisplay } from "../sanitize";
import { htmlToText } from "../sanitize/htmlToText";
import type { Address, ComposeMode, DraftAttachment } from "../types";

export type MimeInput = {
  from: Address;
  to: Address[];
  cc?: Address[];
  bcc?: Address[];
  replyTo?: Address[];
  subject: string;
  html: string;
  /** Derived from html when missing. */
  text?: string;
  attachments?: DraftAttachment[];
  /** Message-ID without angle brackets. Generated from the sender's domain when missing. */
  messageId?: string;
  inReplyTo?: string | null;
  references?: string[];
  headers?: Record<string, string>;
  date?: Date;
  /** Adds a text/calendar alternative with this iTIP method (an iMIP reply). The content must already carry the same METHOD. */
  icalEvent?: { method: string; content: string };
  /** Keep the Bcc header (the copy saved to Sent and Drafts). Never set for mail sent over SMTP. */
  keepBcc?: boolean;
};

const DATA_IMG = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+))\2/gi;

export function newMessageId(fromAddress: string): string {
  const domain = fromAddress.split("@")[1] || "flint.local";
  return `${randomBytes(16).toString("hex")}@${domain}`;
}

const stripBrackets = (id: string): string => id.replace(/^<|>$/g, "");
const bracket = (id: string): string => `<${stripBrackets(id)}>`;

/** Replaces inline data: images with cid: references and returns the matching inline attachments. */
export function extractDataImages(html: string): { html: string; inline: Attachment[] } {
  const inline: Attachment[] = [];
  const seen = new Map<string, string>();
  const out = html.replace(DATA_IMG, (_m, pre: string, quote: string, _uri: string, type: string, b64: string) => {
    const clean = b64.replace(/\s+/g, "");
    let cid = seen.get(clean);
    if (!cid) {
      cid = `img${inline.length + 1}-${randomBytes(6).toString("hex")}@flint`;
      seen.set(clean, cid);
      const ext = (type.split("/")[1] ?? "png").replace(/\+.*$/, "");
      inline.push({ filename: `image${inline.length + 1}.${ext}`, content: Buffer.from(clean, "base64"), contentType: type, cid, contentDisposition: "inline" });
    }
    return `${pre}${quote}cid:${cid}${quote}`;
  });
  return { html: out, inline };
}

const toList = (list: Address[] | undefined) => (list ?? []).map((a) => ({ name: a.name, address: a.address }));

function attachmentOf(a: DraftAttachment): Attachment {
  const base: Attachment = { filename: a.filename, path: a.path, contentType: a.contentType };
  return a.inline && a.contentId ? { ...base, cid: a.contentId.replace(/^<|>$/g, ""), contentDisposition: "inline" } : base;
}

/** Builds a complete RFC 822 message: multipart/alternative (text + html), inline cid images, attachments. */
export async function buildMime(input: MimeInput): Promise<Buffer> {
  const { html, inline } = extractDataImages(input.html);
  const text = input.text ?? htmlToText(html, { wordwrap: 76 });
  const options: MailOptions = {
    from: { name: input.from.name, address: input.from.address },
    to: toList(input.to),
    cc: toList(input.cc),
    bcc: toList(input.bcc),
    replyTo: input.replyTo?.length ? toList(input.replyTo) : undefined,
    subject: input.subject,
    html,
    text,
    messageId: bracket(input.messageId ?? newMessageId(input.from.address)),
    inReplyTo: input.inReplyTo ? bracket(input.inReplyTo) : undefined,
    references: input.references?.length ? input.references.map(bracket).join(" ") : undefined,
    headers: input.headers,
    date: input.date,
    alternatives: input.icalEvent ? [{ contentType: `text/calendar; charset=utf-8; method=${input.icalEvent.method.toUpperCase()}`, content: input.icalEvent.content }] : undefined,
    attachments: [...inline, ...(input.attachments ?? []).map(attachmentOf)],
  };
  const node = new MailComposer(options).compile();
  node.keepBcc = input.keepBcc === true;
  return node.build();
}

// ---------- Reply and forward helpers ----------

export type ReplySource = {
  from: Address[];
  to: Address[];
  cc: Address[];
  replyTo: Address[];
  subject: string;
  date: number;
  messageId: string | null;
  references: string[];
  rawHtml: string | null;
  text: string | null;
};

export type ReplyDraft = {
  to: Address[];
  cc: Address[];
  subject: string;
  quotedHtml: string;
  inReplyTo: string | null;
  references: string[];
  attachments: DraftAttachment[];
};

export type ReplyOptions = {
  /** Attachments of the original, already saved to disk by the caller. Carried over for forwards only. */
  forwardAttachments?: DraftAttachment[];
  timeZone?: string;
  /** Receipts endpoint host currently configured. Its pixels are always removed from quotes, along with the default host. */
  receiptsHost?: string;
  /** Inline (cid:) image parts of the original by Content-ID, so quoted and forwarded bodies keep their pictures. */
  inlineImages?: Record<string, { contentType: string; data: Uint8Array }>;
};

const DEFAULT_RECEIPTS_HOST = "flintr.xanom.co";
const RECEIPTS_PIXEL_PATH = /\/i\/[A-Za-z0-9_-]{22}\.gif(?:[?#"'\s]|$)/;

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function dedupe(list: Address[], exclude: Set<string>): Address[] {
  const seen = new Set(exclude);
  const out: Address[] = [];
  for (const a of list) {
    const key = a.address.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: a.name, address: a.address.trim() });
  }
  return out;
}

export function prefixedSubject(subject: string, mode: ComposeMode): string {
  const s = subject.trim();
  if (mode === "forward") {
    if (/^(?:fwd?|wg|vs)\s*:/i.test(s)) return s.replace(/^((?:fwd?|wg|vs)\s*:\s*)+/i, "Fwd: ");
    return `Fwd: ${s}`;
  }
  if (/^(?:re|aw|sv|antw)\s*:/i.test(s)) return s.replace(/^((?:re|aw|sv|antw)\s*:\s*)+/i, "Re: ");
  return `Re: ${s}`;
}

const formatAddress = (a: Address): string => (a.name ? `${a.name} <${a.address}>` : a.address);

function formatWhen(ms: number, timeZone?: string): string {
  const d = new Date(ms);
  const date = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(d);
  return `${date} at ${time}`;
}

/** Quoted mail must never carry a receipts pixel, whatever endpoint it points at: it would count other people's opens. */
function stripReceiptsPixels(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => (RECEIPTS_PIXEL_PATH.test(tag) ? "" : tag));
}

function originalBodyHtml(src: ReplySource, opts: ReplyOptions): string {
  if (src.rawHtml) {
    const cidResolver = (cid: string): string | null => {
      const part = opts.inlineImages?.[cid];
      return part ? `data:${part.contentType};base64,${Buffer.from(part.data).toString("base64")}` : null;
    };
    const clean = sanitizeForDisplay(src.rawHtml, { allowRemoteImages: true, receiptsHost: opts.receiptsHost ?? DEFAULT_RECEIPTS_HOST, cidResolver });
    return stripReceiptsPixels(clean.html);
  }
  return `<div style="white-space:pre-wrap">${escapeHtml(src.text ?? "")}</div>`;
}

/**
 * Recipients, subject, quoted block and threading headers for a reply, reply all or forward.
 * Reply all drops the user's own addresses and aliases and removes duplicates.
 */
export function buildReplyDraft(message: ReplySource, mode: Exclude<ComposeMode, "new">, userAddresses: Iterable<string>, opts: ReplyOptions = {}): ReplyDraft {
  const own = new Set([...userAddresses].map((a) => a.trim().toLowerCase()));
  const sender = message.from[0];
  const fromMe = sender ? own.has(sender.address.toLowerCase()) : false;
  const subject = prefixedSubject(message.subject, mode);
  const body = originalBodyHtml(message, opts);

  if (mode === "forward") {
    const lines = [
      "---------- Forwarded message ---------",
      `From: ${message.from.map(formatAddress).join(", ")}`,
      `Date: ${formatWhen(message.date, opts.timeZone)}`,
      `Subject: ${message.subject}`,
      `To: ${message.to.map(formatAddress).join(", ")}`,
      ...(message.cc.length ? [`Cc: ${message.cc.map(formatAddress).join(", ")}`] : []),
    ].map(escapeHtml).join("<br>");
    return {
      to: [], cc: [], subject, inReplyTo: null, references: [],
      quotedHtml: `<div class="flint_forward"><div>${lines}</div><br>${body}</div>`,
      attachments: opts.forwardAttachments ?? [],
    };
  }

  const primary = fromMe ? message.to : message.replyTo.length ? message.replyTo : message.from;
  let to = dedupe(primary, own);
  let cc: Address[] = [];
  if (mode === "replyAll") {
    to = dedupe([...primary, ...(fromMe ? [] : message.to)], own);
    const toKeys = new Set(to.map((a) => a.address.toLowerCase()));
    cc = dedupe(message.cc, new Set([...own, ...toKeys]));
  }
  if (to.length === 0 && message.to.length) to = dedupe(message.to, new Set());
  const who = sender ? formatAddress(sender) : "the sender";
  const header = `On ${formatWhen(message.date, opts.timeZone)}, ${escapeHtml(who)} wrote:`;
  const quotedHtml = `<div class="flint_quote"><div>${header}</div><blockquote style="margin:0 0 0 0.8ex;padding-left:1ex;border-left:1px solid #ccc">${body}</blockquote></div>`;
  const refs = message.messageId ? [...message.references, message.messageId] : [...message.references];
  return { to, cc, subject, quotedHtml, inReplyTo: message.messageId, references: [...new Set(refs)], attachments: [] };
}
