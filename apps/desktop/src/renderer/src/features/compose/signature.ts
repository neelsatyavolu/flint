import type { AccountId, ComposeMode, Signature } from "@flint/core";

/** Class used inside the editor view (mock drafts also use it). */
export const SIGNATURE_CLASS = "flint-signature";
/** Class core writes into drafts and searches for when swapping a signature. Saved HTML must use it. */
export const CORE_SIGNATURE_CLASS = "flint_signature";
export const SIGNATURE_SELECTOR = `.${SIGNATURE_CLASS}, .${CORE_SIGNATURE_CLASS}`;

export type SignatureDefaults = {
  defaultSignatureByAccount: Record<AccountId, number | null>;
  defaultReplySignatureByAccount?: Record<AccountId, number | null>;
};

const isReply = (mode: ComposeMode): boolean => mode === "reply" || mode === "replyAll";

/** What settings say for an account: a signature id, null for "none", undefined for "no choice". Same rule as the backend. */
export function chosenSignatureId(defaults: SignatureDefaults, accountId: AccountId, mode: ComposeMode): number | null | undefined {
  const forReply = defaults.defaultReplySignatureByAccount;
  if (isReply(mode) && forReply && accountId in forReply) return forReply[accountId];
  return defaults.defaultSignatureByAccount[accountId];
}

/**
 * The default signature for an account, following the same rules as the backend: the settings choice (null = none),
 * else the signature flagged for new mail or replies, the account's own before a shared one.
 * A choice that points at a deleted signature counts as no choice.
 */
export function defaultSignatureFor(signatures: Signature[], accountId: AccountId, mode: ComposeMode, defaults: SignatureDefaults): Signature | null {
  const chosen = chosenSignatureId(defaults, accountId, mode);
  if (chosen === null) return null;
  const picked = chosen === undefined ? undefined : signatures.find((s) => s.id === chosen);
  if (picked) return picked;
  const flagged = signatures.filter((s) => (isReply(mode) ? s.defaultReply : s.defaultNew));
  return flagged.find((s) => s.accountId === accountId) ?? flagged.find((s) => s.accountId === null) ?? null;
}

/** Signatures the user can pick for a From account: that account's own and the shared ones. */
export function signaturesForAccount(signatures: Signature[], accountId: AccountId): Signature[] {
  return signatures.filter((s) => s.accountId === null || s.accountId === accountId);
}

/** Replaces (or removes, with null) the signature block in a body. Pure string in, string out. */
export function swapSignatureHtml(html: string, signature: Signature | null): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  doc.body.querySelectorAll(SIGNATURE_SELECTOR).forEach((el) => el.remove());
  if (signature) {
    const block = doc.createElement("div");
    block.className = CORE_SIGNATURE_CLASS;
    block.setAttribute("data-signature-id", String(signature.id));
    block.innerHTML = signature.html;
    doc.body.append(block);
  }
  return doc.body.innerHTML;
}

/** True when the body holds nothing but whitespace, empty paragraphs and the signature. */
export function isBodyEmpty(html: string): boolean {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  doc.body.querySelectorAll(SIGNATURE_SELECTOR).forEach((el) => el.remove());
  if (doc.body.querySelector("img,table,hr")) return false;
  return (doc.body.textContent ?? "").trim() === "";
}
