import { access } from "node:fs/promises";
import type { MimeInput } from "../mail/compose";
import { htmlToText } from "../sanitize/htmlToText";
import type { Store } from "../store";
import { FlintError, type Account, type Draft } from "../types";

/** What the recipient sees: the body the user wrote (signature included) followed by the quoted original. */
export function fullBodyHtml(draft: Pick<Draft, "html" | "quotedHtml">): string {
  const quote = draft.quotedHtml ? `<br>${draft.quotedHtml}` : "";
  return `<!doctype html><html><body>${draft.html}${quote}</body></html>`;
}

export function senderOf(account: Account, from: string): { name: string; address: string } {
  return { name: account.name, address: from };
}

/** Everything MimeInput needs from a draft, except the message id, tracking header and pixel. */
export function draftMimeInput(store: Store, draft: Draft, account: Account, plainTextOnly: boolean): MimeInput {
  const meta = store.getDraftMeta(draft.id);
  const html = fullBodyHtml(draft);
  const text = htmlToText(html, { wordwrap: 76 });
  return {
    from: senderOf(account, draft.from),
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
    html: plainTextOnly ? "" : html,
    text,
    attachments: draft.attachments,
    inReplyTo: meta.inReplyTo,
    references: meta.references,
  };
}

/** Throws a readable error when an attachment file went missing from the draft's folder. */
export async function assertAttachmentsExist(draft: Draft): Promise<void> {
  for (const a of draft.attachments) {
    try {
      await access(a.path);
    } catch {
      throw new FlintError("not_found", `The attachment "${a.filename}" is no longer on this computer. Remove it and add it again.`);
    }
  }
}
