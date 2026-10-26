import type { Address } from "@flint/core";
import { countRecipients } from "./recipients";
import { SIGNATURE_SELECTOR } from "./signature";

/** Checks the user can confirm past with "Send anyway". */
export type SoftStop = "no_subject" | "no_attachment";
export type SendCheck = "ok" | "no_recipients" | SoftStop;

type Checked = { to: Address[]; cc: Address[]; bcc: Address[]; subject: string; html?: string; attachments?: readonly unknown[] };

// Bare "attach"/"attaches" counts only with an object ("attach the deck"), so "attach no meaning" stays quiet.
const MENTIONS_ATTACHMENT = /\b(attach(ed|ments?|ing)|enclos(ed|ing)|attach(es)?\s+(it|them|this|these|that|those|the|a|an|my|our|your))\b/i;
const QUOTE_SELECTOR = ".flint_quote, .gmail_quote, blockquote";

/** True when the text the user wrote (not the signature or quoted mail) talks about an attachment. */
export function mentionsAttachment(html: string): boolean {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  doc.body.querySelectorAll(`${SIGNATURE_SELECTOR}, ${QUOTE_SELECTOR}`).forEach((el) => el.remove());
  return MENTIONS_ATTACHMENT.test(doc.body.textContent ?? "");
}

/**
 * Decides whether a draft can go out now. Missing recipients block; a missing subject or a mentioned but missing
 * attachment are soft stops the user can confirm past. `skip` lists soft stops already confirmed.
 */
export function checkSend(draft: Checked, skip: readonly SoftStop[] = []): SendCheck {
  if (countRecipients(draft) === 0) return "no_recipients";
  if (!skip.includes("no_subject") && draft.subject.trim() === "") return "no_subject";
  if (!skip.includes("no_attachment") && (draft.attachments?.length ?? 0) === 0 && mentionsAttachment(draft.html ?? "")) return "no_attachment";
  return "ok";
}
