import type { AccountId, Signature } from "@flint/core";

export const SIGNATURE_CLASS = "flint-signature";

/** The default signature for an account, following the same rules as the backend: per-account default plus the new/reply flag. */
export function defaultSignatureFor(
  signatures: Signature[],
  accountId: AccountId,
  mode: "new" | "reply",
  defaults: Record<AccountId, number | null>,
): Signature | null {
  const id = defaults[accountId] ?? null;
  const sig = signatures.find((s) => s.id === id);
  if (!sig) return null;
  return (mode === "new" ? sig.defaultNew : sig.defaultReply) ? sig : null;
}

/** Signatures the user can pick for a From account: that account's own and the shared ones. */
export function signaturesForAccount(signatures: Signature[], accountId: AccountId): Signature[] {
  return signatures.filter((s) => s.accountId === null || s.accountId === accountId);
}

/** Replaces (or removes, with null) the signature block in a body. Pure string in, string out. */
export function swapSignatureHtml(html: string, signature: Signature | null): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  doc.body.querySelectorAll(`.${SIGNATURE_CLASS}`).forEach((el) => el.remove());
  if (signature) {
    const block = doc.createElement("div");
    block.className = SIGNATURE_CLASS;
    block.setAttribute("data-signature-id", String(signature.id));
    block.innerHTML = signature.html;
    doc.body.append(block);
  }
  return doc.body.innerHTML;
}

/** True when the body holds nothing but whitespace, empty paragraphs and the signature. */
export function isBodyEmpty(html: string): boolean {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  doc.body.querySelectorAll(`.${SIGNATURE_CLASS}`).forEach((el) => el.remove());
  if (doc.body.querySelector("img,table,hr")) return false;
  return (doc.body.textContent ?? "").trim() === "";
}
