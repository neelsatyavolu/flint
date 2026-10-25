import type { AccountId, ComposeMode, Settings, Signature } from "../types";

const OPEN_TAG = /<div\b[^>]*\bclass="[^"]*\bflint_signature\b[^"]*"[^>]*>/i;
const DIV_TAG = /<(\/?)div\b[^>]*>/gi;

/** The marked block a signature lives in, so it can be found, swapped and removed later. */
export function signatureBlock(sig: Signature): string {
  return `<div class="flint_signature" data-signature-id="${sig.id}">${sig.html}</div>`;
}

/** Start and end of the signature block, counting nested divs. Null when the draft has none. */
function findBlock(html: string): { start: number; end: number } | null {
  const open = OPEN_TAG.exec(html);
  if (!open) return null;
  const start = open.index;
  let depth = 1;
  DIV_TAG.lastIndex = start + open[0].length;
  for (let m = DIV_TAG.exec(html); m; m = DIV_TAG.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return { start, end: m.index + m[0].length };
  }
  return { start, end: html.length };
}

export function hasSignature(html: string): boolean {
  return findBlock(html) !== null;
}

/** Puts `sig` in the draft: in place of the existing block, else after the body. A null signature removes the block. */
export function replaceSignature(html: string, sig: Signature | null): string {
  const found = findBlock(html);
  if (!found) return sig ? `${html}<br>${signatureBlock(sig)}` : html;
  const before = html.slice(0, found.start);
  const after = html.slice(found.end);
  return sig ? `${before}${signatureBlock(sig)}${after}` : `${before.replace(/(<br\s*\/?>\s*)+$/i, "")}${after}`;
}

type SignatureSource = {
  getSignature(id: number): Signature | null;
  listSignatures(): Signature[];
};

/**
 * The signature a new draft starts with. Settings win when they name one for the account (null = none),
 * otherwise the signature flagged as default for new mail or for replies, account-specific before shared.
 */
export function defaultSignature(source: SignatureSource, settings: Settings, accountId: AccountId, mode: ComposeMode): Signature | null {
  const chosen = settings.compose.defaultSignatureByAccount[accountId];
  if (chosen === null) return null;
  if (chosen !== undefined) {
    const sig = source.getSignature(chosen);
    if (sig) return sig;
  }
  const flag = mode === "reply" || mode === "replyAll" ? "defaultReply" : "defaultNew";
  const all = source.listSignatures().filter((s) => s[flag]);
  return all.find((s) => s.accountId === accountId) ?? all.find((s) => s.accountId === null) ?? null;
}
